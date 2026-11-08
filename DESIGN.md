---
name: Backflow
description: As-built drawings of web apps. One drawing set across the site, the README art and the Figma plugin.
colors:
  sheet: "#eef2f5"
  sheet-2: "#e3e9ef"
  paper: "#f8fafc"
  line: "#c5d1e0"
  line-strong: "#8fa3bf"
  ink: "#1b1f24"
  ink-2: "#46515f"
  ink-3: "#5f6b78"
  blue: "#1f4fa8"
  blue-hover: "#183f88"
  blue-soft: "#dce5f4"
  on-blue: "#ffffff"
  red: "#b5261a"
  red-soft: "#f9dcd8"
  green: "#23704a"
  green-soft: "#d9eee2"
  amber: "#9a5500"
  amber-icon: "#b86a00"
  amber-soft: "#fbecd3"
  pressed: "#d6dfe9"
  disabled-text: "#7d8896"
  blueprint-sheet: "#0f2a55"
  blueprint-sheet-2: "#0b2147"
  blueprint-paper: "#143366"
  blueprint-hover: "#163463"
  blueprint-line: "#2f4c7c"
  blueprint-line-strong: "#6f86ad"
  blueprint-ink: "#f2f6fb"
  blueprint-ink-2: "#c3cee0"
  blueprint-ink-3: "#9aabc6"
  blueprint-blue: "#ffffff"
  blueprint-blue-hover: "#dce8ff"
  blueprint-blue-soft: "#1e4180"
  blueprint-disabled: "#1e3a6a"
  blueprint-red: "#ff8f80"
  blueprint-red-soft: "#4a2440"
  blueprint-green: "#7fdca6"
  blueprint-green-soft: "#163f4a"
  blueprint-amber: "#f4c45a"
  blueprint-amber-soft: "#3d3a3a"
  blueprint-rule: "#9cc2ff"
  white: "#ffffff"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "84px"
    fontWeight: 660
    lineHeight: "0.98"
    letterSpacing: "-0.035em"
  h1:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 640
    lineHeight: "1.04"
    letterSpacing: "-0.025em"
  h2:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 640
    lineHeight: "24px"
  lede:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: "1.55"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: "1.6"
  small:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "1.55"
  caption:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.5"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.08em"
  plugin-title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 640
    lineHeight: "18px"
  plugin-body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "17px"
  numeral:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  dim:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "16px"
  log:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: "15px"
rounded:
  tag: "2px"
  control: "4px"
  panel: "6px"
  stamp: "3px"
  pill: "24px"
  disc: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  row-pad: "16px"
  gutter: "24px"
  sheet-pad: "32px"
  indent: "40px"
  block: "48px"
  hero: "56px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.on-blue}"
    rounded: "{rounded.control}"
    height: "24px"
  button-armed:
    backgroundColor: "{colors.red}"
    textColor: "{colors.on-blue}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  command-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  checklist-row:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.blue}"
    typography: "{typography.plugin-title}"
    height: "48px"
---

# Design System: Backflow

## Overview

**Creative North Star: "As-Built"**

As-built drawings are made after construction, from the real building. Backflow does that for web apps, and every Backflow surface is a sheet from one drawing set: the landing site (`site/`), the README art rendered from it (`docs/assets/`), the Figma plugin window (`plugin-lift/ui.html`) and the Claude Design system. The identity was chosen by the user from a direction round on 2026-11-08 (the As-Built card, seed `af2b0674`), with the plugin in the full Backflow skin rather than Figma's UI3 look.

Two themes, one set. **Blueline** (light) is a diazo print: blue linework on a cool sheet. **Blueprint** (dark) is a cyanotype: white linework on Prussian blue. The site follows the system theme and offers a Blueline/Blueprint toggle; the plugin follows Figma's theme (`.figma-dark`).

**Key characteristics:**
- Four printed inks: blueline, graphite, red pen, and the sheet. No gradients, glows or glass.
- The drawing grammar is content: sheet border with grid bubbles, title block, dimension lines with real values, revision clouds and deltas, review stamps, schedules and General Notes.
- Archivo across its width axis is the lettering: wide for headings, normal for reading, narrow caps for labels. JetBrains Mono only for code, commands, dimensions and numerals.
- Numbers are the content: counts, percentages and failure reasons are always shown, in tabular figures.

Source files: `brand/tokens.css` (CSS custom properties `--bf-*`), `brand/tokens.json` (DTCG), `brand/BRAND.md` (brand book), `scripts/build-brand.mjs` (logo).

## Colors

### Primary
- **Blueline** (`blue` #1f4fa8; Blueprint: white): headings, linework, links, the sheet border, the primary action, row titles in the plugin. Hover `blue-hover`; pressed, selection and info washes `blue-soft`. Text on a blue fill is `on-blue` (white; Prussian on Blueprint's white fill).

### Review hues (state only)
- **Red pen** (`red` #b5261a; Blueprint #ff8f80): redlines, revision clouds and deltas, the REVISE stamp, failures, the armed confirm button. Soft ground `red-soft`.
- **Approved green** (`green` #23704a): done, APPROVED, F0, created/exists statuses.
- **Attention amber** (`amber` #9a5500 for text, `amber-icon` #b86a00 for glyphs and F2): needs attention, review/changed statuses.

### Neutral
- **Sheet** (`sheet` #eef2f5): page and window ground. **Sheet 2** (#e3e9ef): insets, tags, wells, hover. **Paper** (#f8fafc): raised fields: inputs, stat tiles, loaded-file card, the elevation drawing.
- **Hairline** (`line` #c5d1e0) for dividers; **dimension line** (`line-strong` #8fa3bf) for dimension lines, outlines, dashed drop targets, ghost values and F3.
- **Ink** (#1b1f24), **ink-2** (#46515f, 7.2:1 on sheet), **ink-3** (#5f6b78, 4.8:1; hints only).

### Named Rules
**The Four Inks Rule.** Nothing a diazo printer couldn't print: no gradients, glows, blur or glass. Depth is tone and hairlines.
**The Red Pen Rule.** Red marks change or failure, nothing else. Never a section colour, never emphasis.
**The Ladder Rule.** F0 = green, F1 = blue, F2 = amber, F3 = `line-strong`. F3 is a floor, not a failure, so it is never red.

## Typography

**Sans:** Archivo variable (wdth 62–125, wght 100–900), self-hosted from `brand/fonts/` (SIL OFL); embedded as a data URI in the plugin, which has no network access.
**Mono:** JetBrains Mono variable, same handling.

### Hierarchy
- **Display** (660, 44–84px fluid, width 118%, −0.035em, `blue`): the one hero headline.
- **H1** (640, 32–48px fluid, width 118%, −0.025em, `blue`): section headings on the site.
- **H2** (640, 17–20px, width 112%, `blue`): schedule row heads, flow box titles, link-list titles.
- **Lede** (400, 19/1.55) and **Body** (400, 17/1.6): reading text, 65–75ch.
- **Label** (600, 11/16, width 78%, uppercase, +0.08em, `ink-2`): title-block labels, table heads, plugin qualifiers and result sub-heads.
- **Plugin title** (640, 13/18, width 112%, `blue`) and **Plugin body** (400, 12/17): the plugin window.
- **Code** (mono 15/22), **Dim** (mono 500 11px: dimension text, tags), **Numeral** (mono 600 14/20: stat tiles), **Log** (mono 10.5/15: the run log only).

### Named Rules
**The Width Axis Rule.** Hierarchy is width as much as size: wide for headings, normal for reading, narrow caps for labels.
**The Mono-Is-Data Rule.** Mono only for code, commands, file names, dimensions and numbers in data. Never as a "technical" costume.

## Layout

The site is one drawing sheet: max 1320px, a 1.5px `blue` border, 28px outside margin on desktop (12px on phones), grid bubbles A–M on a 12-column grid along the top edge (A–D on phones). Inside: a 12-column grid with a 24px gap and 32px side padding (16px on phones). The hero splits 5 columns of copy and 7 of drawing; sections are separated by 1.5px rules with 96px vertical padding (64px on phones). A title block closes the hero; a revision history closes the page.

The plugin window opens at 400 × 680 and is resizable from 340 × 420 to 900 × 1200. A 48px header (mark, file name, page and check time, re-check) sits above a 1.5px rule. Checklist rows are 48px minimum with 16px left padding; open-row content is indented 40px to align with the title text. Spacing follows a 4px rhythm.

## Elevation & Depth

Flat. Sheets are separated by rules, rows by hairlines, insets by `sheet-2`, raised fields by `paper`. The only shadow is the toast (`0 2px 6px` and `0 10px 24px` of Prussian at 18%).

## Shapes

Small corners: 2px tags and checkboxes, 4px controls, inputs and the command field, 6px panels and the drop overlay, 3px stamps. The sample phone in the drawing uses its own radii (28px device, 10px cards, 24px button) because it depicts an app, not Backflow. Dashed borders mean either "drop here" (`line-strong`) or "previous value" (ghost).

Icons are authored 16×16 strokes: no fill, `currentColor`, 1.25 stroke, round caps and joins. The mark is the "b" drawn as one line whose bowl flows back into its stem and ends in a drafting harpoon, the first letter of the wordmark.

## Components

- **Command field** (site): a title-block field with the label "Try it on your app", one real command (`npx backflow-cli init`) and a Copy button on a `blue` fill. Copy confirms with a toast, or explains how to copy by hand.
- **Elevation drawing** (site): the sample screen as linework with dimension lines (390, 844, 12, 16), part notes on leaders, a dashed ghost of the old button, a revision cloud with delta 1 and a REVISE stamp. Hovering (or tapping) a part reveals its measurements.
- **Title block, schedule, General Notes, fidelity ladder legend, revision history** (site): drawing-set conventions used as the page's structure.
- **Review stamps**: Approved (green), Revise (red), Rejected (ink, struck through), rotated −4°.
- **Checklist row** (plugin): status glyph, `plugin-title`, count line, chevron; one row open at a time; 2px progress bar by `scaleX`.
- **Buttons** (plugin): 24px, 4px radius, 600 weight. Primary `blue`; secondary outlined in `line-strong`; ghost in `blue` text; armed confirm in `red` ("Apply without preview?"); disabled `sheet-2`/`disabled-text` with a tooltip saying why.
- **File loader, tags, stat grid, ladder bar, KV table, item list, notes, callouts, log, toast, drop overlay** (plugin): behaviour unchanged from the previous checklist design; colours and type come from the tokens above.

## Motion

One authored moment per surface. Site: the revision cloud draws itself (`stroke-dashoffset`, 900ms, from 0.5s), the delta fades in, the stamp lands once (scale 1.35 → 1, 320ms). Plugin: 120ms colour feedback, 180–220ms disclosure, glyph pop and result rise on `cubic-bezier(.16, 1, .3, 1)`; progress is transform-only. Under `prefers-reduced-motion` everything is drawn at rest and spinners stop.
