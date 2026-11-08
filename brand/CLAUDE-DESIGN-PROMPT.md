# Backflow: prompt for Claude Design (Claude desktop)

The Backflow design system already exists as a Claude Design artifact: https://claude.ai/artifact/49i1wf3LUXwtGHdaQnv7Yk (private until you share it). Attach it to a new design, or paste the prompt below to build screens from scratch. Attach `brand/tokens.json`, `brand/backflow-wordmark.svg`, `brand/backflow-mark.svg` and the two font files in `brand/fonts/` when you can.

---

You are designing for **Backflow**, a free, open-source tool that turns a running web app into a real Figma file (auto-layout, design tokens, components and variants), so that in AI-era teams, where code changes faster than design, designers can review what shipped in Figma and approve, revise or reject it. Tagline: **"Your app, drawn as built."** Audience: front-end developers and design engineers who run it, and the designers who review the result. Voice: plain, precise, technical. Short declarative sentences, numbers instead of adjectives, limits stated openly, no hype, no emoji, sentence case.

**The visual world is an architect's as-built drawing set.** As-built drawings are made after construction, from the real building; Backflow does that for apps. Every surface is a sheet from one drawing set.

**Themes.**
- *Blueline* (light, a diazo print): ground `sheet #EEF2F5`, insets `sheet-2 #E3E9EF`, raised fields `paper #F8FAFC`, hairlines `line #C5D1E0`, dimension lines `line-strong #8FA3BF`, body text `ink #1B1F24`, secondary `ink-2 #46515F`, hints `ink-3 #5F6B78`, linework/headings/primary `blue #1F4FA8` (hover `#183F88`, soft `#DCE5F4`), text on blue `#FFFFFF`.
- *Blueprint* (dark, a cyanotype): ground `#0F2A55`, insets `#0B2147`, raised `#143366`, hairlines `#2F4C7C`, dimension lines `#6F86AD`, text `#F2F6FB` / `#C3CEE0` / `#9AABC6`. Linework and primary fills turn **white**; text on a white primary fill is `#0F2A55`.
- *State colours, never decoration*: red pen `#B5261A` (dark `#FF8F80`) for redlines, revision clouds, the REVISE stamp and failures; green `#23704A` (dark `#7FDCA6`) for approved/done; amber `#9A5500` (dark `#F4C45A`) for needs attention.
- Four printed inks only: no gradients, glows, glass, or neon. Flat. The only shadow is the toast's.

**Type.** Archivo (variable, width axis 62–125%) for everything read: headings at width 118%, weight 640–660, tracking −0.025 to −0.035em, in `blue`; body at width 100%, 17/27 on the web; labels uppercase at width 78%, 600, +0.08em tracking, in `ink-2`. JetBrains Mono only for commands, file names, dimensions and numerals in data, with tabular figures. Never Inter, never Space Grotesk.

**Drawing grammar** (always as content, never ornament):
- The sheet: a 1.5px `blue` border around the page with grid bubbles (A B C … circles, 26px) on its top edge.
- A title block of real facts: Project · Drawn from (localhost) · Output (Figma) · Scale (1 : 1) · Rev (v1.0) · License (MIT).
- Dimension lines with 45° ticks showing values Backflow really measures (390 width, gap 12, pad 16, Hug / Fill / Fixed).
- Revision clouds (scalloped red outlines) and revision deltas (a triangle with a number) mark what changed; the previous value stays as a dashed ghost.
- Rubber stamps for the review decision: APPROVED (green), REVISE (red), REJECTED (ink, struck through), rotated −4°.
- Schedules (ruled tables) instead of feature cards; numbered General Notes instead of icon grids.
- Hatching (45° hairlines) for image placeholders.

**Logo.** A lowercase "b" drawn as one continuous monoline stroke whose bowl flows back into its own stem and ends in a drafting harpoon. It is the first letter of the wordmark "backflow" (Archivo width 112, weight 620). Use the supplied SVGs; never redraw it.

**Shape and space.** 4px rhythm (4 8 12 16 24 32 48 72 96). Radii 2 / 4 / 6px only. Hairlines separate; no cards inside cards; no coloured side borders; no eyebrow labels above headings; no section numbers like 01/02/03.

**Motion.** One authored moment per surface: the revision cloud draws itself (900 ms, ease `cubic-bezier(.16,1,.3,1)`) and the stamp lands once. Respect reduced motion.

### Design these screens

1. **Landing page, desktop 1440 and mobile 390, both themes.** First viewport: the sheet with grid bubbles; left five columns hold the wordmark, the headline "Your app, drawn as built.", one lede sentence, a command field "TRY IT ON YOUR APP / $ npx @backflow/cli init" with a Copy button, and links "Quick start", "Star on GitHub", "MIT · free for everyone". The right seven columns hold an elevation drawing of a sample phone screen ("Today", a hatched card "Upper body · 45 min · 6 exercises", three list rows, a "Start session" button), dimensioned 390 × 844, with a revision cloud around the button, delta 1 and a REVISE stamp. A title block strip closes the viewport. Then: "From the running app back to the design file." (a flow schematic: Your app → Extract → Measured JSON → Figma plugin with Tokens / Components / Screens, plus a dashed red return line "Design reviews · decisions flow back to code"); "Built for review, not for redrawing." (Rev 0 vs Rev 1 of a card, padding 12 → 16 with the ghost, and the three stamps explained); "What lands in Figma." (a schedule table: Auto-layout, Tokens, Components, Screens, RTL; plus the F0–F3 fidelity ladder legend); "General notes." (six numbered notes: Local only, No network in Figma, Measured not guessed, Honest about loss, Previews first, Old files keep working); "Free for everyone. Built by everyone." (Star, Contribute, Discuss, Sponsor); a revision-history footer.
2. **The Backflow Figma plugin window, 400 × 680, both themes.** A header with the mark, the file name ("Athlete app · design export") and "Page "Screens" · checked 14:11", over a 1.5px blue rule. Four checklist rows (Fonts, Tokens, Components, Screens), each with a 16px status glyph, a 13px blue title (with an OPTIONAL label), a count line ("58 variables · 17 styles from Backflow") and a chevron. Show states: Tokens open with a loaded tokens.json card and tags, two options with full-sentence descriptions, a shield safety line ("**Preview** changes nothing. **Apply** creates only what's missing…") and Preview / Apply buttons; Components with the armed "Apply without preview?" red button; Screens result with "3 of 3 screens in 4.8 s", the F0–F3 ladder bar (83 / 11 / 4 / 2%), a stat grid (214 frames, 388 text layers, 46 icons…) and a design-system key-value table.
3. **Figma Community cover, 1920 × 960**, and a **social card, 1200 × 630**: the hero composition at poster scale.

Keep every number realistic, label sample content as sample, and invent no testimonials, user counts or benchmarks.
