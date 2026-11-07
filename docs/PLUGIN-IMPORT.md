# Import plugin: components and tokens

`plugin/` ("Figma Lift Import") builds screens from `*.figma.json`. Two optional layers sit on top of the plain build. Both are inert unless the JSON carries the fields and the checkbox is on, so a plain export builds exactly as before.

| Option | Needs in the JSON | Needs in the Figma file |
|---|---|---|
| Use components | `cmp` on nodes (from `componentize.mjs`) | the masters built by `plugin-components` |
| Bind tokens | `tok` on nodes (from `tokens.mjs`) | the variables and styles created by `plugin-tokens` |

Both boxes tick themselves when the pasted JSON contains `"cmp":` or `"tok":`. Two optional file pickers: `_library.json` (slot tables, only needed when the masters carry none) and `tokens.json` (name fallback when a variable has no tag).

Order in a fresh file: tokens plugin (dry run, then apply), components plugin, then import the enriched screens. Keep tokens, components and screens in **one** file: local components cannot be imported by key (docs/VERIFY-DS-RESULTS.md E10).

## Registry convention

The plugin finds things through shared plugin data, namespace `figmalift`:

| Node | Key | Value |
|---|---|---|
| master (`COMPONENT` or `COMPONENT_SET`) | `cmp` | component id from `_library.json` |
| master | `slots` | JSON of the slot table (optional, `_library.json` is the fallback) |
| variable or style | `tokenKey` | token key, for example `c:2f6fed@100`, `r:8`, `sp:12`, `t:Inter/14/500/20/0` |
| variable | `tokenRole` | `fill`, `stroke`, `text`, `icon` (picks the right variable when one colour has several) |

The registry is read once per import: `loadAllPagesAsync`, then `findAllWithCriteria` on every page. A master whose name contains "superseded" loses against a live one.

## What an instance gets

For a node with `cmp`:

1. Variant: the member of the set that matches `cmp.v` (closest member if a combination is missing; counted as a "variant hole").
2. Overrides `cmp.ov`, in this order: variant switches, then everything else. Slot ids are looked up in the slot table; `3.2` walks into nested instance 3. Text and boolean slots use component properties, icons use `INSTANCE_SWAP`, colours and opacity are direct overrides.
3. Size: `resize()` to the source rectangle, then the usual auto-layout sizing pass of the parent.
4. Icons: stroke weight is scaled by hand (a resized instance keeps its stroke weight, E4) and the colour is bound or recoloured.
5. Check: the instance's children are compared with the source rectangles. Text may drift (Figma and Chrome shape text differently); everything else must be within 2 px + 8 %.

## Failure ladder (never aborts an import)

| Rung | When | Result |
|---|---|---|
| R0 | all overrides applied, check passes | instance |
| R1 | only the safe overrides (text without runs, booleans, variants) pass the check | instance |
| R2 | still failing, full overrides, loose check | instance **detached** to a frame, still named after the component |
| R3 | no master, tool marked it `rej`, or a **content** override (text, boolean, icon, image, variant) failed | plain frame built from the retained children |

A failed content override always ends in R3. A component with the wrong label is worse than a plain frame.

The run summary reports: instances (R0 / R1 / detached), icons, plain-frame fallbacks (missing master, left plain by the tool), override failures, token bindings with "no match" count, root fill fixes, variant holes. A `Notes:` block lists the first override failures with the slot id.

## Token binding

Order for a colour: the variable tagged with the key (preferring the matching `tokenRole`, then scopes), then `tokens.json` target name, then the value (same lookup as "Bind colours"). Gradient stops are bound inside the paint literal (`stops[i].boundVariables.color`, E12). Numbers (gap, padding, radius, stroke weight) use the tagged FLOAT variable, then the value. Text styles are applied **before** the text runs and the fill, because applying a style overwrites range overrides (E11). Effect styles bind through the `e` key.

## Testing without Figma

```
node plugin-mock.mjs fixtures/ds/enriched-sample.figma.json --ds            # masters from fixtures/ds/_library.json, variables from tokens.json
node plugin-mock.mjs fixtures/ds/enriched-sample.figma.json --ds --drop=cmp_button_8ff3   # missing master
node plugin-mock.mjs fixtures/ds/enriched-sample.figma.json --ds --no-slots [--lib]       # slot tables only in the library file
node plugin-mock.mjs <file> [bind] [--no-layout] [--no-grid] [--text-scale=1.04] [--quiet]
```

`tools/plugin-import.test.mjs` runs these in `npm test`. The mock catches JS errors, API misuse the typings document and ladder logic. It is **not Figma**: it has no real text metrics and masters are not auto-layout, so a few instances (an icon button, a button whose icon is hidden) detach in the mock where Figma would keep them. Judge real behaviour in Figma.

## Verified in real Figma

Still open: the full chain (tokens plugin, components plugin, import with both options) has not yet been run in a real file. First run: use the fixture (`fixtures/ds/`) in a scratch file and compare the summary line with the mock's.
