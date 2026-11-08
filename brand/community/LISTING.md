# Figma Community listing: Backflow

Publish from Figma desktop: Plugins → Development → Backflow → Publish. Figma assigns a new plugin id on first publish; put it in `plugin-lift/manifest.json` (`"id"`) and commit it.

- **Icon**: `icon-128.png` (128 × 128)
- **Cover**: `cover-1920x960.png` (1920 × 960)
- **Name**: Backflow
- **Tagline** (max 100 chars): Your running web app, drawn as built: real auto-layout, tokens, components and variants.
- **Category**: Design tools · Development
- **Tags**: code to design, auto-layout, design tokens, design system, components, variants, html to figma, developer handoff, open source, RTL
- **Network access**: none (the manifest declares `allowedDomains: ["none"]`)
- **Support contact**: https://github.com/asiln/backflow/issues

## Description

Backflow turns a running web app into a real Figma file, so designers can review what shipped in the tool they already use.

When code moves faster than design, the Figma file falls behind. Backflow runs the other way. A small open-source CLI captures your app on localhost, and this plugin builds it in your file:

- **Tokens**: colour variables, text styles, radii and spacing. Re-runs match by key and never duplicate.
- **Components**: master components, variant sets and icon sets found in your screens.
- **Screens**: real auto-layout with Hug, Fill and Fixed sizing, editable text, vector icons and images, imported as instances with tokens bound.

Every step previews before it changes the file. Results come back as numbers: the share of containers at each fidelity level (F0 auto-layout to F3 absolute), what was created, and exactly what failed and why.

Private by construction: the plugin has no network access and capture runs on your machine against localhost only. Free and MIT licensed; community run and sponsor funded.

Get started:
```
npx github:asiln/backflow init
npx github:asiln/backflow extract screens.json
```
Then drop the JSON files on the plugin window. Docs: https://github.com/asiln/backflow

Backflow is an independent open-source project and is not affiliated with Figma, Inc.
