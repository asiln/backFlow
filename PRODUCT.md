# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The product's UI surfaces are Figma plugin windows (HTML iframes inside the Figma desktop app). The CLI's output is text in the terminal.

## Users

Front-end developers and design engineers who own a running web app that has no up-to-date Figma file. They want an editable Figma file built from what the app actually renders, not a redraw from memory. The first audience is the public open-source community.

What they're doing when they use it: running a local or staging copy of their app with test accounts. They write batch files that list screens, run the extractor in a terminal, then switch to Figma desktop and paste or pick the JSON in a development plugin. They're technical, comfortable with Node and JSON, and they read logs and reports to judge fidelity.

## Product Purpose

Backflow turns a running web app into real Figma auto-layout: editable text, vector icons, images, gradients and shadows. Sizing (Hug, Fill, Fixed) is inferred from how the page actually renders. Further steps harvest design tokens and repeated components, so screens import as instances of masters with variables bound.

Success means the imported file is something a designer can keep working in. The layout holds when content changes, colours and type are tokens, repeated UI is components, and every place where fidelity was lost is reported, never hidden.

## Positioning

All four of these together are the claim. Future work keeps all of them:

1. **Local, no quota.** Extraction runs on the user's machine against localhost only, using Playwright. There's no Figma API quota and no cloud upload. The plugins declare `networkAccess: none`, so private app data never leaves the machine.
2. **Real auto-layout, verified.** Layout is inferred from computed styles and style-override probes, then checked against an auto-layout simulator. Each container gets an honest fallback level (F0 auto-layout with inferred sizing, down to F3 absolute), and the level is reported. The plugin re-checks the result in Figma and steps a container down a level if it deviates.
3. **Full design system, not just screens.** Tokens (colour variables, text styles, radii, spacing), components, variant sets and icon sets are built in the same file, and screens become instances with tokens bound.
4. **RTL / Persian fidelity.** RTL rows are ordered by visual position. Persian text falls back to Vazirmatn. `???` corruption is detected and flagged.

## Operating Context

- Terminal: the `backflow` CLI (`bin/backflow.mjs`, npm `backflow-cli`) wrapping `extract.mjs`, `run-all.mjs`, `pipeline.mjs` (a manifest with preflight, before/after and finally hooks), `diff.mjs` (pixel fidelity check), `tokens.mjs`, `componentize.mjs`, and `plugin-mock.mjs` (the plugin run against a mocked Figma API).
- Figma desktop, development plugins: **Backflow** (`plugin-lift/`, the merged plugin), and the single-purpose **Backflow Import** (`plugin/`), **Backflow Tokens** (`plugin-tokens/`), **Backflow Components** (`plugin-components/`), plus verification plugins (`plugin/verify/`, `plugin/verify-ds/`).
- The intended order in Figma: Tokens (dry run, then apply), Components (dry run, then apply), Import with "Use components" and "Bind tokens".
- Artifacts: batch JSON files, `out/<batch>.figma.json`, per-screen reports with warnings, `summary.json` / `SUMMARY.md`, `tokens.json`, `_library.json`.

## Capabilities and Constraints

- The extractor refuses non-localhost origins. Don't weaken this.
- Only test accounts are used. The password comes from `$BACKFLOW_TEST_PASSWORD` (pre-1.0 `$FIGMA_LIFT_TEST_PASSWORD` still read), never a batch file. Exports can contain real app content, so `out/`, `batches/`, `state-*.json` and the config stay gitignored.
- New JSON fields are optional and older exports must still import (backward compatibility is a rule).
- Everything degrades gracefully: a missing master, a failed override or an unreadable image gives a plain frame or a labelled placeholder, never an aborted import.
- Persian text never goes through shell arguments. It lives in batch files.
- Figma needs the Vazirmatn, Space Grotesk and JetBrains Mono fonts.
- Plugin UIs are plain HTML/CSS/JS with no build step and no network access.
- Known limits are documented in the README (pseudo-elements, clip-path/mask, most filters, skew, some grid modes). Don't claim these as supported.

## Brand Commitments

- Name: **Backflow** (formerly Figma Lift). Plugin names: "Backflow", and "Backflow Import / Tokens / Components" for the single-purpose plugins. npm: `backflow-cli`, command `backflow`.
- Identity: the As-Built drawing set (chosen by the user, 2026-11-08). Blueline light theme, cyanotype Blueprint dark theme, Archivo and JetBrains Mono, the one-stroke "b" mark. Source of truth: `brand/` and DESIGN.md.
- The plugin window carries the full Backflow skin (user decision), not Figma's UI3 look.
- Fully open source and community run: MIT, free for everyone, funded by sponsors. No paid tier, no account.
- Voice (from README and docs): plain, precise and technical. Short declarative sentences, limits stated openly, no hype. Fidelity numbers and failure reasons are reported, not glossed over.
- Never use Figma's name as a prefix, or Figma's colours or marks, in Backflow's identity. Backflow is not affiliated with Figma, Inc.
- License: MIT. Repository: github.com/asiln/backflow.

## Evidence on Hand

- Fixture test page: `fixtures/index.html`, `fixtures/serve.mjs`, plus sample design-system fixtures in `fixtures/ds/`.
- Verification notes from real Figma: `docs/VERIFY-DS-RESULTS.md`. Specs: `docs/AUTO-LAYOUT-SPEC.md`, `docs/COMPONENTS-AND-DESIGN-SYSTEM-SPEC.md`.
- Missing, and future work must not invent them: testimonials, user counts, benchmarks against competitors, published fidelity statistics, press, or a hosted demo.

## Product Principles

1. **Measured over guessed.** Every structural decision comes from what the browser rendered, and is checked before it's trusted.
2. **Honest degradation.** When fidelity drops, step down a level, keep going, and say where and why.
3. **Private by construction.** Local only, no network, no secrets in files. Safety rules are features, not friction.
4. **Additive and compatible.** New capability never breaks an old export or an old batch.
5. **Editable output is the product.** A pixel match that a designer can't work in is a failure.

## Accessibility & Inclusion

RTL languages, Persian in particular, are first-class. No other product-specific accessibility standard has been set yet.
