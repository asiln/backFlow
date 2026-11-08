# Contributing to Backflow

Thanks for helping. Backflow turns a running web app into real Figma auto-layout, so most contributions fall into one of: extractor fixes (`walker.js`), layout inference (`normalize.mjs`, `layout-sim.mjs`), the Figma plugin (`plugin/`), or docs.

## Ground rules

- **Never commit private data.** No real app URLs, accounts, phone numbers, IDs, passwords, tokens, exports (`out/`), sessions (`state-*.json`), or your own `batches/` and config. They are gitignored; keep it that way. Use `batches.example/` for examples.
- **Test accounts and local or staging apps only.** The extractor refuses non-localhost origins by design. Do not weaken that.
- Keep changes **backward compatible**: new JSON fields are optional, old exports must still import.
- One topic per pull request, small and reviewable.

## Setup

```
git clone https://github.com/asiln/backflow.git
cd backflow
npm install
cp backflow.config.example.json backflow.config.json   # then edit it for your app
```

You need Node 18 or newer and a Chromium that Playwright can drive.

## Checks before opening a PR

```
npm run check      # syntax-checks every script and the plugin code
```

If you touch the extractor or layout engine, also run it on the bundled fixture page and on a page of your own, and compare with `diff.mjs` (see the README). Include the numbers (coverage per layout level, pixel difference) in the PR description.

The Figma plugin cannot run outside Figma. `plugin-mock.mjs` exercises the plugin code against a mock of the API, which is useful but is not Figma: say in the PR what you verified in the real app.

## Where things live

| Path | What |
|---|---|
| `walker.js` | runs inside the page, reads computed styles, geometry, text, SVG, images |
| `extract.mjs` | Playwright driver, batch files in, `.figma.json` out |
| `normalize.mjs`, `layout-sim.mjs` | infer auto-layout, verify it, fallback ladder |
| `plugin/` | Figma plugin that builds the layers |
| `plugin/verify/` | test plugin that settles open questions in real Figma |
| `diff.mjs` | pixel comparison between the page and a re-render from the JSON |
| `docs/` | specs and design notes |

## Reporting bugs

Open an issue with: the page or a minimal HTML reproduction, the batch entry, the report from `extract.mjs`, what you expected, and what Figma showed (a screenshot helps). Remove anything private first.

## Code of conduct

Be kind and constructive. See `CODE_OF_CONDUCT.md`.
