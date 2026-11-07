# Figma Lift Components (plugin-components)

Development plugin `Figma Lift Components` (id `figma-lift-components-1`, no network). It reads `_library.json` (`docs/ds-schema/library.schema.json`, written by `componentize.mjs`) and builds the **masters** in the open file: one `COMPONENT` per component, one `COMPONENT_SET` per component with variants, and one icon set per icon (`Icon/<name>`, one member per size). The import plugin then instantiates them (docs/PLUGIN-IMPORT.md).

## Run it

1. `node componentize.mjs --in "out/final/**/*.figma.json" --out out/enriched --report` (also writes `tokens.json` when the token tools are present).
2. Run the tokens plugin first if you want bound colours in the masters (docs/PLUGIN-TOKENS.md).
3. Figma desktop: Plugins, Development, Import plugin from manifest..., `plugin-components/manifest.json`; open it in the target file.
4. Paste or choose `_library.json`. **Dry run** first (creates nothing, lists CREATE / EXISTS / CHANGED per master), then **Apply**. **Review report** lists the review-band components and any matches against an existing design system.
5. Import the enriched screens with the import plugin (options "Use components" and "Bind tokens").

## What it builds

- Page `Lift Components` (a Section per group when the file is at the 3-page limit of the Starter plan; the page is reused if present).
- Masters are built with the same code path as the import plugin, then promoted with `createComponentFromNode` (E1: layout is kept). Text slots become TEXT properties, optional parts BOOLEAN properties (hidden child leaves the flow, E6), icon slots INSTANCE_SWAP, nested components are instances with exposed properties (E7).
- Variants: component properties are added **before** `combineAsVariants` (E5), members are named `Prop=Value, Prop2=Value2`, laid out on a grid after combining (E17). A missing combination is never requested; masters that would need a hole are built without it.
- Every master gets `setSharedPluginData('figmalift', 'cmp', id)` and `('figmalift','slots', JSON)`. The description carries the confidence band (`[REVIEW]` for the review band) and the usage counts.
- Icons: stroke weight is not scaled by instance resize in Figma (E4), so icon members exist per size.

## Idempotence and changes

A master is found by its tag, on any page (`loadAllPagesAsync` + `findAllWithCriteria`, E9). A second Apply creates nothing. If a library entry changed (hash of its content plus the build version), "Changed library entry" builds the new master, renames the old one `(superseded <date>)` and moves the tag. Nothing is ever deleted.

## Failure ladder (a single failure never aborts the run)

| Rung | Meaning |
|---|---|
| R0 | built exactly |
| R1 | a feature failed (grid placement, auto-layout, one override) and was skipped; flagged |
| R2 | master bounds did not match after build; fixed by resize |
| R3 | a dependency (nested master or icon) failed; the part is a plain frame/svg |
| R4 | this master could not be built; reported, the rest continue (resume by running Apply again) |

The summary counts each rung and lists `flags` and `errors` with the component id.

## Tests

`node plugin-components/_mock.mjs` runs 43 checks against the fixture library (dry run, apply, idempotence, supersede, Section fallback, ladder, cancel/resume, dependency cycles). `FL_STRESS_LIB=<path>/_library.json node plugin-components/_mock.mjs` stress-runs a real library: on the 456-screen corpus of the author (848 components, 171 icons) it creates 1019 masters with 0 failures and a clean second run (about 20 s in the mock). The mock is not Figma; real timings and layout will differ. Real-Figma verification of the full chain is still open.
