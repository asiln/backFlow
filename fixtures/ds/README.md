# Design-system fixtures

Generic, fictional fixtures for the components / design-system pipeline (spec `docs/COMPONENTS-AND-DESIGN-SYSTEM-SPEC.md`).
Everything is synthesised by `build-fixtures.mjs` (English copy, neutral palette, Inter font, no real app, no ids from a real database):

```
node fixtures/ds/build-fixtures.mjs    # regenerates every JSON file here (deterministic) and self-validates
npm run validate:ds                    # schemas + cross-file consistency
```

| File | Role | Schema |
|---|---|---|
| `plain-sample.figma.json` | input of `tokens.mjs` / `componentize.mjs`: 3 screens, 81 nodes, plain export schema with `ls` | `screen-file` |
| `enriched-sample.figma.json` | expected output of `componentize.mjs` (+ `tok` from `tokens.mjs`): the plain tree plus `cmp` / `tok`, children retained | `screen-file` |
| `_library.json` | expected `out/enriched/_library.json` | `library` |
| `tokens.json` | expected `out/enriched/tokens.json` | `tokens` |
| `ds-inventory.json` | input: the design system "already in the Figma file" | `inventory` |
| `ds.config.json` | input: project config (thresholds, tokenMap, nameHints, ...) | `config` |
| `component-decisions.json` | input: example owner decisions | `decisions` |
| `tailwind.config.cjs` | input: tiny CommonJS Tailwind config referenced by `ds.config.json` | none |

## The fictional app

Screens (390 px wide): `Settings / Default / 390` (header with badge, two Cards with Cancel/Save buttons, a list of 3 rows),
`Items / List / 390` (header, 4 rows, an icon Button "Add item", a Card whose second Button is disabled) and
`Items / Delete dialog / 390` (scrim + dialog panel with title, badge, text, Cancel/Delete). Child coordinates are parent-relative
and come from a tiny layout engine in the builder (approximate text widths; good enough for contracts, not pixel truth).

## Derivation (what the tools must produce from `plain-sample`)

Config: `ds.config.json` (thresholds `occ 3`, `occTiny 4` for nodes < 6, `screens 2`, `minUses 3`, `minScreens 2`, `colorDeltaE 1.5`, `alphaTol 0.02`, `dsMode report`). One input file, so `files = 1`.

### tokens.json (`tokens.mjs`)

1. Harvest every node (including the retained children of future instances). Count one use per node field:
   fill / stroke / shadow colour / text colour (role `fill|stroke|shadow|text`), svg root `stroke` colour (role `icon`), radius, `ls.g`, `ls.g2`
   (> 0 and <= 128), each `ls.p[i] - ls.bw[i]` (> 0), shadow stack, interactive height (`button` nodes -> `sz:h44`), text style.
   `screens` = distinct screens. Only colours are split by role; `count` of other families merges gap and padding uses (`sp:12` = 42).
2. Keys: `c:rrggbb@aa`, `t:Inter/14/500/20/0`, `r:8`, `sp:12`, `e:0,8,24,0,000000@20`, `sz:h44` (see `tools/ds/common/keys.mjs`).
3. Tailwind names from `tailwind.config.cjs` (colour match within 1/255 per channel, alpha variants `black/40`), then `tokenMap` by role
   (`ink` + `text` -> `text/primary`); alpha variants append `-<aa>`; roles missing from `tokenMap` fall back to `<bg|text|border|icon|effect>/<tailwind name>`.
4. Status per entry:
   * target variable/style exists in `ds-inventory.json` by name -> `bound` (regardless of count);
   * else colour with other variable(s) of the same value and a compatible scope -> `review` (`candidates`);
     here `c:e8ebf0@100 fill` (two variables `bg/chip`, `bg/secondary-button`) and `c:2f6fed@100 icon` (fill variable `bg/accent`);
   * else `count >= minUses && screens >= minScreens` -> `create`; otherwise `skip`;
   * radius/spacing values not on the Tailwind scale and above thresholds -> `off-scale` with `nearest` (`r:10` x3 from the badge, `sp:3` x6), below thresholds -> `skip` (`sp:17` x2 on one screen).
5. `findings` list the off-scale values, below-threshold paddings and `review` entries.

### Annotation (`tok`, writer module `annotate.mjs`)

Per node, keys are written only for entries with status `bound|create|review` (never `skip`/`off-scale`; those values stay literal):
frames `f` (fill) `s` (stroke) `r` `g` `g2` `p` (after subtracting `ls.bw`, `null` for 0/untokenised sides) `e`; text `tx` + `ts`; svg `ic`.
Example: the dialog panel has `tok = {f, g, p:[sp:24 x4]}` but no `r` (`r:16` is `skip`) and no `e` (`e:...` is `skip`).

### Components (`componentize.mjs`)

Candidates (spec 1.3) and thresholds (1.5) produce three clusters; the rest stay frames:

| Cluster | Source nodes | occ | screens | nodes | why accepted |
|---|---|---|---|---|---|
| Button | 9 `button · ...` frames (4 on Settings, 3 on List, 2 in the dialog) | 9 | 3 | 3 (superset with icon) | tiny (< 6 nodes) needs >= 4 occurrences |
| Card | 3 `article · ...` (2 + 1) with two nested Button instances | 3 | 2 | 6 | >= 3 occurrences, >= 2 screens |
| List Item | 7 `item · ...` rows (3 + 4) | 7 | 2 | 4 | tiny, 7 >= 4 |

Not components: header rows (2 occurrences, tiny), badges (3 occurrences but tiny -> needs 4), the dialog panel (1), list/row wrapper frames (generic), screens.

* Merge within tolerance: the dialog's `Delete` button has horizontal padding 17 vs 16 (tolerance 1) -> same cluster, `cmp.dev = 1`; `devMean = 0.11`, `devMax = 1`.
* Names: `nameHints.roles` (`button`, `article`, `item`) -> nameSource `role`; groups from `nameHints.groups`.
* Ids: `cmp_<slug>_<hash4(S of the master root)>` with the S digest of `tools/ds/common/hash.mjs` (Button: the superset root with its icon; Card: with nested Buttons collapsed to `C:<buttonId>`).
* Variants (Button): property inference over the paint partition: root fill accent vs muted -> `Type = Primary | Secondary` (via `variantNames.fill`),
  root opacity 0.5 vs 1 -> `State = Disabled | Default`. Members present: Primary/Default (n 4), Secondary/Default (n 4), Primary/Disabled (n 1); Secondary/Disabled never occurs (a hole).
* Optional part: one Button has a leading icon -> LCS superset root gets the icon; slot `0` BOOLEAN `Show icon` (default false = leader has none), slot `1` INSTANCE_SWAP `Icon`, slot `2` TEXT `Label` (default `Save`).
* Overrides = differences from the master defaults (slot ids are indices into `slots[]`; `3.2` = inner slot 2 of the nested instance in slot 3):
  `Cancel` -> `{s:"2",t:"Cancel"}`; `Add item` -> `[{s:"0",b:true},{s:"2",t:"Add item"}]`; List-page Card -> `{s:"3",v:{Type:"Primary",State:"Disabled"}}` + `{s:"3.2",t:"Apply"}`.
  A nested Button also keeps its own `cmp` in the retained children (the parent's dotted overrides are what the plugin applies when it instantiates the parent).
* List Item: slot `0` swap `Icon` (leader: accent bell), slot `1` text `Label`; the trailing chevron is a constant icon instance, not a slot. A row with the dim user icon gets
  `{s:"0", ic:"ic_<user>", c:"c:6b7280@100"}` (`c` = icon colour token key, written only when it differs from the master icon's colour and has a live token).
* Icons: every `svg` is an icon instance `{id:"ic_<geom>", kind:"icon"}`; `geom` in these fixtures is the stand-in `hashStr(path data)`; `T5` owns the real `iconSig` and may change it (then regenerate).
  `Bell` and `User` match `ds-inventory.json` icons (`ds`).
* Confidence (spec 1.9 formula, `nameSource role = 0.9`, one file): Button 88 (`auto`), Card 75 (`review`), List Item 84 (`auto`).
* `ds` (existing design system): Button matches inventory component set `Button` (score 0.88, mode `report`, property and variant maps).

### Consistency checks (`scripts/validate-ds.mjs`)

enriched minus `cmp`/`tok` deep-equals plain; every `cmp.id` and override slot resolves; slot paths/defaults agree with `root`; bands match confidences;
every `tok` key exists in `tokens.json` with a live status; `bound` entries exist in the inventory; `source` counts match the plain sample.
