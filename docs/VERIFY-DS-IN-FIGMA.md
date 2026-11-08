# Verify the components and design-system assumptions in Figma (run once)

The components and design-system work (`COMPONENTS-AND-DESIGN-SYSTEM-SPEC.md`, section 9) depends on Figma runtime behaviour that the typings do not settle. `plugin/verify-ds/` runs the twenty experiments E1 to E20 in a scratch file, removes everything it created, and prints one JSON object (E1..E20, `CFG`, `_meta`) plus a copy-ready `CFG` block. It follows the pattern of `VERIFY-IN-FIGMA.md` (the auto-layout verify plugin).

## Owner steps

1. Open a **scratch** Figma file in the desktop app (never a real design file). Install **Vazirmatn Regular** from Google Fonts first, otherwise E20 runs with Inter and its RTL answer is not representative (the plugin warns and records `vazirmatnAvailable: false`). For the most complete E9 answer, give the scratch file a second page that contains at least one frame.
2. Plugins, Development, Import plugin from manifest, choose `plugin/verify-ds/manifest.json`.
3. Run Plugins, Development, **Backflow DS Verify**. Keep the plugin window open. A progress list shows E1 to E20 with state and milliseconds; hover a row to see its decision. Expect 1 to 3 minutes: E3, E8 and E16 are timed loops that stop on a time budget, every experiment has a 90 s timeout.
4. When the header says "Done and cleaned up", press **Copy all** and paste the text back (the `CFG` block comes first, then the full JSON). "Copy CFG only" copies just the block.
5. Optional, E19 (multi-command manifest): also import `plugin/verify-ds/manifest-menu.json` (a second plugin "Backflow DS Verify (menu probe)" with two menu entries). Run the entry "Probe figma.command only (E19)", wait for "Done", and send its `E19` and `CFG.menuCommandsAvailable` / `figmaCommandValue` lines. Then run "Run all experiments" once from the same menu; if both entries appear in the menu and `figma.command` is `probe` / `run`, the multi-command syntax is confirmed.

What the plugin creates: a page `FL_VERIFY_work` (all nodes live there; the original page is untouched), a page `FL_VERIFY_page2` (E9), and variable collections, variables and text/effect/paint styles whose names all start with `FL_VERIFY_`. At the end it removes nodes, variables, collections, styles, then pages, switches back to your original page, and sweeps once more for anything named `FL_VERIFY_*` (including leftovers of an earlier crashed run). The removal result is printed under `_meta.cleanup`. If the plugin is closed or Figma crashes mid-run, run it again once (the pre-sweep removes the leftovers) or delete the `FL_VERIFY_*` pages, collections and styles by hand.

## Output shape

```json
{
  "E1": { "status": "ok", "ms": 12.3, "observed": { "...": "..." }, "decision": "Promote-after-build keeps ..." },
  "...": {},
  "E20": { "status": "ok", "ms": 80, "observed": {}, "decision": "..." },
  "CFG": { "promoteKeepsLayout": true, "useInstanceSizing": true, "...": "..." },
  "_meta": { "vazirmatnAvailable": true, "totalMs": 74000, "cleanup": { "...": "..." } }
}
```

`status` is `ok`, `ok-fallback-font` (E20 without Vazirmatn), `error`, `timeout`, or `skipped` (probe command). A failed experiment never stops the others; its `decision` starts with `UNKNOWN` and all its `CFG` flags are `null`. Timings and loop counts are only recorded as measurements for E3, E8 and E17 (the experiments that ask for them); every experiment also has its total `ms`.

## What each experiment answers, and the decision table

| # | Question | CFG flags it decides | If true / if false |
|---|---|---|---|
| E1 | Does `createComponentFromNode` keep layoutMode, sizing modes, FILL text, ABSOLUTE children, constraints, stroke-in-layout? | `promoteKeepsLayout` | true: `buildMaster` = `build()` then promote. false: re-apply the listed diffs after promotion, or build masters with `figma.createComponent()`. |
| E2 | Do instances accept `resize()` and `layoutSizingHorizontal='FILL'`, and does a HUG instance grow with a longer TEXT property? | `useInstanceSizing`, `instanceHugGrowsWithText` | true: `sizeInstance` as in spec 2.3. false: verify and fall back to a plain frame (rung R3). |
| E3 | Is `createInstance()` faster than building an 8-node button by hand (plain frame vs Section parent; with and without `setProperties`)? | `instancesFasterThanManual`, `instanceBatchSize` | true: componentize pays off. `instanceBatchSize` = instances per roughly 250 ms UI-yield slice. |
| E4 | Does resizing an icon instance scale its stroke weight? Can nested vector strokes be bound to a variable and `strokeWeight` overridden on an instance? | `iconStrokeScaleOnResize`, `nestedPaintOverrideBinds`, `nestedStrokeWeightOverridable` | scale true: one master per icon + resize. scale false: per-size variants or a `strokeWeight` override (spec 3.3). Bind false: icon colour cannot follow variables on instances. |
| E5 | Do TEXT properties added before `combineAsVariants` survive on the set? What does a hole in the Type x State matrix do? | `componentPropertiesBeforeCombine`, `variantHoleSupported` | true: keep spec 2.4 order. false: add properties to the set after combining. |
| E6 | Does a hidden child (and a BOOLEAN property set to false) collapse its `itemSpacing` gap in a HUG auto-layout? | `hiddenChildGapCollapses`, `booleanPropHidesChild` | true: optional parts as BOOLEAN render like the source. false: also adjust padding/gap or remove the node. |
| E7 | Can `isExposedInstance` be set; do nested instance props work through the parent instance; does INSTANCE_SWAP via `setProperties(componentId)` work? | `exposeNested`, `nestedPropsViaParent`, `swapViaSetProperties` | true: nested overrides and icon slots as in spec 2.5. false: SLOT/plain overrides, or no nested exposure. |
| E8 | Cost of `setBoundVariableForPaint`, `setBoundVariable('itemSpacing')` and `setTextStyleIdAsync` in pools of 100 (loops capped at 10,000 calls or 3 s; the count used is recorded). | `bindScope`, `bindMsPerCall` | `all` if the extrapolated time for the full corpus (91,383 nodes x (paint + field) + 30,000 text styles) is at most 120 s, else `components`. |
| E9 | Can a registry on another page be searched with `findAllWithCriteria({sharedPluginData})` after `loadAllPagesAsync`; does `getNodeByIdAsync` resolve across pages? Does `figma.root` have `findAllWithCriteria`? | `registryCrossPage`, `registryRootFindAll` | true: masters on a separate `Lift Components` page, found by a loop over `figma.root.children`. false: keep masters on the screens' page. |
| E10 | Does `importComponentByKeyAsync` / `importComponentSetByKeyAsync` accept the key of an unpublished local component? | `localKeyImportWorks` | false (expected): cross-file reuse needs a published library, keep exports and the design system in one file. |
| E11 | Does `setTextStyleIdAsync` keep range font size/fills and a bound fill variable? Does style-then-runs work? | `textStyleKeepsRuns`, `textStyleKeepsBoundFill`, `styleBeforeRunsWorks` | false/false: apply the style first, re-apply runs, bind fills after the style (spec 4.5). |
| E12 | Does an effect style keep a bound colour variable? Which call form binds a gradient stop? | `effectStyleBindsVariable`, `gradientStopBindForm` | form string is the exact call to use in the tokens plugin; `null` = gradients stay literal. |
| E13 | Are `lineHeight` PIXELS 16.5 / 13.75 / 19.5 stored exactly? Is `letterSpacing` 0.025em exact as PERCENT 2.5 or PIXELS 0.275? | `lineHeightFractionalExact`, `letterSpacingUnit` | `letterSpacingUnit` is the unit to write; `lineHeightFractionalExact` false means round line heights (see `observed.lineHeights`). |
| E14 | Do variable scopes persist; does the Primitives to Color alias chain work; is WEB code syntax stored; can a second mode be added (plan limit)? | `variableScopesPersist`, `aliasChainWorks`, `codeSyntaxWorks`, `multiModeAvailable` | any false: adjust spec 4.5 item 2 to 4 (flat variables, no aliases, or single mode). |
| E15 | Does an instance inherit `clipsContent`, opacity, blend mode, fills order, effects, child order; can opacity, blend, clip and rotation be overridden on an instance? | `instanceRootPropsPreserved`, `instanceRotationSettable`, `instanceRootOverridable` | false: nodes with those properties (rotated roots, blended roots) stay plain frames. |
| E16 | Do `swapComponent`, `mainComponent` assignment and `setProperties({Type})` keep instance text overrides; per-call cost over 200 toggles. | `swapKeepsOverrides`, `variantSwitchApi` | `variantSwitchApi` is the cheapest API that keeps overrides, or `createInstance from the right variant child`. |
| E17 | `combineAsVariants` with 24 members: time, positions before layout, set size after the grid helper. | `combineLayoutHelperNeeded`, `variantSetOf24Ok` | helper needed true (expected): always run the grid layout + `resizeWithoutConstraints`. `variantSetOf24Ok` false: cap set size. |
| E18 | Component inside a Section, `description`, `documentationLinks` persistence. | `componentInSectionOk`, `descriptionPersists`, `documentationLinksWork` | false: put the confidence tag in another field (name suffix or shared plugin data only). The Assets panel itself cannot be read by a plugin; check by hand if you care. |
| E19 | What does `figma.command` return; do multi-command menu manifests work? | `menuCommandsAvailable`, `figmaCommandValue` | true (via `manifest-menu.json`): `plugin-tokens` can use three menu commands. null/false: ship three small plugins. In a plain run `figma.command` is `''` and the flag is `null` (not tested). |
| E20 | Does a TEXT property on a Vazirmatn text keep `textAutoResize` and FILL, grow a HUG width, grow a wrapped height? | `vazirmatnAvailable`, `textPropertyKeepsAutoResize`, `textPropertyRecomputesWidth`, `textPropertyWrapGrowsHeight` | any false: text overrides must be followed by a re-measure / bounds check (spec 5.6.2) or applied as direct characters edits. |

## The CFG flag list

`promoteKeepsLayout`, `useInstanceSizing`, `instanceHugGrowsWithText`, `instancesFasterThanManual`, `instanceBatchSize`, `iconStrokeScaleOnResize`, `nestedPaintOverrideBinds`, `nestedStrokeWeightOverridable`, `componentPropertiesBeforeCombine`, `variantHoleSupported`, `hiddenChildGapCollapses`, `booleanPropHidesChild`, `exposeNested`, `nestedPropsViaParent`, `swapViaSetProperties`, `bindScope`, `bindMsPerCall`, `registryCrossPage`, `registryRootFindAll`, `localKeyImportWorks`, `textStyleKeepsRuns`, `textStyleKeepsBoundFill`, `styleBeforeRunsWorks`, `effectStyleBindsVariable`, `gradientStopBindForm`, `lineHeightFractionalExact`, `letterSpacingUnit`, `variableScopesPersist`, `aliasChainWorks`, `codeSyntaxWorks`, `multiModeAvailable`, `instanceRootPropsPreserved`, `instanceRotationSettable`, `instanceRootOverridable`, `swapKeepsOverrides`, `variantSwitchApi`, `combineLayoutHelperNeeded`, `variantSetOf24Ok`, `componentInSectionOk`, `descriptionPersists`, `documentationLinksWork`, `menuCommandsAvailable`, `figmaCommandValue`, `vazirmatnAvailable`, `textPropertyKeepsAutoResize`, `textPropertyRecomputesWidth`, `textPropertyWrapGrowsHeight`.

The five names the spec lists in section 9 map as follows: `useInstanceSizing` (E2), `exposeNested` (E7), `iconStrokeScaleOnResize` (E4), `bindScope` (E8), `registryCrossPage` (E9). A value of `null` always means "not determined" (experiment failed, timed out, was skipped, or cannot be answered in a plain run).

## Applying the answers

Copy the `CFG` object into the config constants of the components and tokens plugins (`plugin-components/`, `plugin-tokens/`, and the instance path of `plugin/code.js`), the same way `VERIFY-IN-FIGMA.md` does for the auto-layout `CFG`. The components and tokens tasks read these flags instead of assuming behaviour; when a flag is `null`, they must keep the conservative path from the table above (for example: treat `promoteKeepsLayout` as false and re-apply properties after promotion).

## What this cannot show

- Rendering fidelity (pixel comparison): that is the job of the import verification in spec 5.6, not of these probes.
- Behaviour on a file whose other pages were never loaded: E9 reports the pre-load read of a second original page only if the scratch file has one.
- Timings depend on the machine and the file; treat E3/E8/E17 as orders of magnitude, and send the numbers back unrounded.
- The Assets panel listing (E18) and the plan limits of library publishing (E10) are not readable through the plugin API; E10 only shows whether a local key imports.
