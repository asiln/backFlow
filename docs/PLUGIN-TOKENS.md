# Backflow Tokens (plugin-tokens)

Development plugin `Backflow Tokens` (id `backflow-tokens-1`, `documentAccess: dynamic-page`, no network). It reads `tokens.json` (`docs/ds-schema/tokens.schema.json`) and the open Figma file, and has three buttons in ONE UI:

| Button | What it does | Changes the file? |
|---|---|---|
| Dry run | Performs every lookup (collections, variables, text styles, effect styles) and lists a status per token | No (a write attempt throws) |
| Apply | Creates ONLY what is missing; re-running creates nothing new | Yes, additive only |
| Export inventory | Writes `ds-inventory.json` per spec 7.3 / `inventory.schema.json` | No |

Files: `plugin-tokens/manifest.json`, `code.js`, `ui.html`, `_mock.mjs` (test, not part of the plugin).

## Run it in Figma

1. Figma desktop app, open the target file.
2. Menu: Plugins, Development, Import plugin from manifest..., choose `plugin-tokens/manifest.json`.
3. Plugins, Development, Backflow Tokens.
4. Paste `tokens.json` or choose the file. The line under the picker shows the counts it found.
5. Press Dry run. Read the summary and the list (failed, conflict, review first). Press Download result JSON to keep it.
6. Press Apply, then press it again within 5 seconds (two-click confirm; browser dialogs are unreliable in the plugin sandbox). Run Dry run again afterwards: nothing should say `would create`.
7. Press Export inventory (no tokens.json needed). Download `ds-inventory.json` and pass it to `tokens.mjs --inventory`.

Cancel stops after the current item; a cancelled Apply keeps what it already created and the next Apply resumes.

## Statuses

`would create` (dry) / `created` (apply), `exists`, `conflict` (value differs; the file value is kept), `review` (ambiguous token, nothing created; candidates listed), `skipped` (`skip`, `off-scale`, per-corner radius, gradients, bad key), `failed` (exception for that item only; the run continues). Result JSON: `counts`, `byFamily`, `conflicts`, `items[]`, `writes`, `cancelled`.

Options: `Also create review tokens` (off) and `Stamp ownership on matching existing items` (off; writes plugin data only, on items whose value already matches).

## Lookup order (never duplicates)

Variable: `existing.id`, then ownership stamp (`figmalift.tokenKey` + `tokenRole`), then `collection + name`. Text and effect styles: `existing.id`, stamp `tokenKey`, then name. Colour keys repeat across roles (CONTRACT-NOTES #8), so variables are matched on key plus role; the stamp holds `tokenKey`, `tokenRole`, `tokensVer`.

Ownership: `setSharedPluginData('figmalift', ...)` is written on every created object. Whether `Variable` objects accept plugin data is not verified, so the plugin also keeps a registry (`figmalift/reg.*` on the document root, key -> object id). A designer-renamed object is still found by key and reported as `renamedTo`. Nothing is ever deleted, renamed or overwritten.

## What Apply creates

- Collections named in `target.collection` (Primitives first, then Color, Layout, others) with one mode (`Value`). Existing collections are used as they are; only their first mode is read for comparison (E14).
- COLOR and FLOAT variables (colours, radii `r:N`, spacing, sizes `sz:hN`) with explicit scopes (from `target.scopes`, else role/family defaults of spec 4.5) and WEB code syntax (`colors.<tailwind>`, `borderRadius.<x>`, `spacing.<n>`, or `target.codeSyntax.WEB`).
- Aliases: `target.alias` (optional extension, e.g. `Primitives/gray/900`) or, automatically, when exactly one Primitives colour has the same value. Ambiguity is reported and the literal value is written. Primitives get empty scopes and `hiddenFromPublishing`.
- Text styles: family, style, size, line height in px, letter spacing written as PERCENT (em x 100, E13). Fonts: `FONT_MAP`, availability via `listAvailableFontsAsync`, weight to style as in `plugin/code.js` (Space Grotesk has no SemiBold: the next heavier style, Bold, is used), missing family falls back to Inter; every fallback is shown in the item detail.
- Effect styles (drop and inner shadows) with the shadow colour bound to a matching colour variable (role `shadow`, else an `EFFECT_COLOR` or `ALL_SCOPES` variable of the same value), else literal colour.

Not done: gradient paint styles (key format has no fixture; reported as `skipped`), name collisions get no `-2` suffix (reported as `conflict` instead), no value updates of existing items.

## Export inventory

Per contract 7.3: collections with modes, variables (`valuesByMode` keyed by mode id, aliases as `VARIABLE_ALIAS`, `codeSyntax`), paint/text/effect styles, components and component sets on all pages (variants are folded into their set; `props` names lose the `#id` suffix; `fingerprint` per set variant or component), and icons. Icons are heuristic: a standalone component up to 64 px made only of vectors, name without `icon/` prefix, `geom` a 10-hex hash of the vector paths. `T5` may define a different `iconSig`; adjust `geomHash` then. Fingerprints are limited to depth 6 and 40 children per node. Loading every page can be slow in a large file.

## Performance

Index of the file built once; yields to the UI every 25 items (`BATCH`), progress bar, Cancel, try/catch per item, final summary with failures. `figma.skipInvisibleInstanceChildren = true` during inventory.

## Menu variant (optional)

Multi-command manifests (`menu`) are unverified (E19). The three actions are buttons in one UI on purpose. If the menu works, add `commands` to the manifest and read `figma.command` in `code.js` to start an action directly.

## Config constants

Top of `code.js`, named after `docs/verify-ds.cfg.json`: `multiModeAvailable`, `letterSpacingUnit`, `lineHeightFractionalExact`, `codeSyntaxWorks`, `variableScopesPersist`, `aliasChainWorks`, `effectStyleBindsVariable`, `gradientStopBindForm`, `instanceBatchSize`. Local settings: `BATCH`, `FONT_MAP`, `FALLBACK_FAMILY`, `COLLECTION_MODE_NAME`, `AUTO_ALIAS_PRIMITIVES`, `ICON_MAX_SIZE`.

## Tests

`node --check plugin-tokens/code.js` and `node plugin-tokens/_mock.mjs`.

The mock proves (against `fixtures/ds/tokens.json` and `ds-inventory.json`): dry run writes nothing and classifies exists / would create / review / skipped correctly; Apply creates the 8 missing items; a second Apply creates and writes nothing; renamed items are found by key (with and without plugin data on objects, via the registry); conflicts keep the designer value and are reported; empty file gets collections with one mode and Primitives aliases (also predicted in dry run); Space Grotesk SemiBold maps to Bold, missing fonts fall back, letter spacing is PERCENT; effect styles bind colours; one injected failure does not stop the run; cancel and resume work; the exported inventory validates against `inventory.schema.json`.

Only real Figma can prove: that the API calls behave as the fake assumes (`createVariable(name, collection, type)` with a collection object, `renameMode`, `setBoundVariableForEffect`, `setVariableCodeSyntax`, `getLocalVariableCollectionsAsync`), whether Variables and styles take shared plugin data (the registry covers both), real font lists and style names, `componentPropertyDefinitions` shapes on real sets, fingerprint equality with the Node-side view, `findAllWithCriteria` speed on large files, and the UI download behaviour in the plugin iframe.
