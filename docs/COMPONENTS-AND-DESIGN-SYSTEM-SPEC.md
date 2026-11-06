# Components and design-system generation from exported JSON: design spec

Status: research/spec only. No existing file in this repo was changed. Date: 2026-11-07.
Goal: post-process `out/*.figma.json` (no new browser run) into (A) reusable components with instances, variants and overrides, and (B) a design system (variables, text styles, effect styles) that the screens are bound to.

## 0. Sources, evidence, honesty

Verified locally (source of truth, cited as `d.ts:LINE` = `plugin-api-standalone.d.ts` in
`C:\Users\asiln\.claude\plugins\synced\041382b1-e080-4cf2-bca0-f23038ce49f2_05462d0b-2426-4e6f-94d2-25761a3255a3\figma~g2\skills\figma-use\references\`):
`component-patterns.md` (cited `cp.md:LINE`), `gotchas.md` (`gotchas.md:LINE`), `variable-patterns.md` (`vp.md`), `text-style-patterns.md`, `effect-style-patterns.md`, `working-with-design-systems/wwds-components--using.md` (`wwds-using`).
Repo code read: `README.md`, `normalize.mjs` (header + structure), `plugin/code.js` (whole), `docs/AUTO-LAYOUT-SPEC.md`, `docs/VERIFY-IN-FIGMA.md` (header), a real export `out/test-autolayout-v4.figma.json` (25 screens, 1534 nodes).
Design-system source: `ds-ledger.json` (scratchpad `figma-tools/`), `ajdar/frontend/tailwind.config.js`, `ajdar/DESIGN.md` (read only).
Own measurements: a throwaway harvest script (scratchpad `harvest.mjs`, `proto.mjs`) over the 42 real exports in `out/` (probe/test/shot files excluded): **443 screens, 91,383 nodes**. Numbers quoted as "measured" come from there.

Not verified and marked `UNVERIFIED`: anything about public Figma docs/pricing (no WebFetch was done), plugin manifest multi-command syntax, runtime performance numbers, behaviour that the typings do not settle. Section 9 lists experiments (E1-E20) to settle them in real Figma before depending on them. Marked `VERIFY` = needs experiment.

### 0.1 What the real data looks like (measured)

| Fact | Value | Consequence |
|---|---|---|
| Node kinds (v4 sample) | frame 851, text 495, svg 77, img 111 | svg and img are leaves; `ls` exists on all nodes |
| Distinct fills (frame + text colour), 443 screens | 109 | tiny palette; almost all are exact Tailwind tokens (`#191d24`=surface2, `#13161b`=surface, `#8150e7`=accent ...) with alpha variants (`#8150e7@0.1/0.2`, `#1c5552@0.4/0.5/0.6`) |
| Distinct text specs `family\|size\|weight\|lh\|ls` | 110 (top 8 cover ~80% of text nodes) | 20-30 text styles suffice; `lh` includes odd values 16.5, 13.75, 19.5 (Tailwind `leading-*` at 11px/12px) |
| Distinct radii | 43 (top: 16, 8, 20, 10, 9, 6, 14, 3, 5, 22, 4, 9.5) | 16/20/8/10/6 are tokens; 9, 9.5, 14, 22, 3, 5 are off-scale (report as design debt, do not snap silently) |
| Distinct gaps | 99 (12: 4014, 8: 3176, 4, 6, 2, 16, 10, 20, 24) plus artefacts 1.63, 687.36 | harvest must ignore SPACE_BETWEEN artefacts (gap > 128 or fractional) |
| Padding tuples | 247 distinct; top `8/12/8/12` (2620), `2/8/2/8`, `0/4/0/4`, `6/12/6/12`; `17/17/17/17` and `-1/0/0/0` are `ls.p` values that include the border width (`ls.bw`) | bind padding after subtracting `bw` (plugin already does, `configureAuto`) |
| Shadows | 36 distinct; `0 0 16 0 #8150e7@0.25` 244 times = existing effect style "Glow/Violet Charge" | exact match with the existing DS exists |
| Names | semantic prefix + volatile content: `button · ورود`, `item · هشدارapi۱۶ آبان، ۰۰:۴۴`, `div#day-8f69...` | strip after ` · ` and after `#` before using names |
| SVG icons | 151 distinct first-path strings; top: search `M14.4 14.4 9.6 9.6` 627x, chevron `m15 18-6-6 6-6` 613x, message `M7.9 20A9 9...` 578x | strong icon dedup; sizes 14/16/18/20/24 |
| Raw exact-hash clustering (prototype, full structure + metrics + paints, depth>=2, 2..80 nodes, styled or interactive, not generic) | 2273 clusters, 1116 with >= 3 occurrences (22,146 instances) | too many exact clusters. Dominated by shared chrome (sidebar `aside` 62 nodes x 37 screens, notification bell 234x, list item 240x). Needs nesting resolution and variant merging (section 1.7, 2.4) to land in the expected 80-200 components range (estimate, not measured) |

## 1. Component detection (Node: `componentize.mjs`)

Input: all `out/**/*.figma.json` of one project in a single run (cross-file: a Button on the login page in `auth-*.json` and in settings in `athlete-settings.json` end up in one cluster). Output: `out/enriched/_library.json`, enriched per-file JSONs, `components-report.{json,md,html}`.

### 1.1 Node view used by the detector

The detector never reads the raw JSON directly. `view(n)` builds an immutable record per node:

```js
// n = JSON node (t, name, x,y,w,h, fill, stroke, radius, shadow, opacity, clip, font, svg, img fields, ls, children)
function view(n, path, screen, file) {
  const ls = n.ls || {};
  return {
    n, path, screen, file,                       // path = 'childIdx/childIdx/...' from the screen root
    t: n.t,
    role: roleOf(n.name),                         // 'button'|'link'|'input'|'item'|'tab'|'alert'|'list'|'nav'|'h1'..|'div'|'span'|'text'|'gap'|'align'...
    k: ls.k || 'N',                               // H V W G N
    s: ls.s || ['F','F'],                         // F H L per axis (Fixed/Hug/Fill)
    abs: !!ls.abs, sp: !!ls.sp,                   // out of flow / spacer frame inserted by normalize
    styled: !!(n.fill || n.stroke || n.radius || (n.shadow||[]).length || n.layers || n.grads),
    kids: (n.children || []).map((c,i)=>view(c, path+'/'+i, screen, file)),
  };
}
const roleOf = (name) => (/^([a-z0-9]+)(?:#| · |$)/i.exec(name) || [,'frame'])[1].toLowerCase();  // 'button · ورود' -> 'button', 'div#day-8f..' -> 'div'
```

Rule: the label text after ` · ` and any `#id` are never used in identity, only (optionally) in naming (1.6).

### 1.2 Three digests per node (Merkle, bottom-up, O(N))

For each node compute `S` (shape), `M` (metrics), `P` (paints). All are string-hashed with a fast hash (sha1 truncated to 10 hex chars is enough; measured dataset is 91k nodes).

| Digest | Includes | Excludes |
|---|---|---|
| `S` shape | node type; for frames: `ls.k`, `ls.s` (F/H/L pair) of the node *as a child*, `abs`, `clip`, `pos`; child count and order; recursively children `S`; for text: `single|multi`, `trunc`, `hasRuns`; for svg: just `svg`; for img: `fit`; nested component instance: `C:<cmpId>` (variant-agnostic) | text content, image data, svg path, absolute x/y, all colours, all numbers |
| `M` metrics | quantised numbers: `ls.g`, `ls.g2`, `ls.p`, radius (all corners), stroke widths, shadow x/y/blur/spread, font size/weight/lh/ls/family, width/height **only on axes whose sizing is `F`** (a `H` or `L` axis is free: that is what makes a 358px wide and a 200px wide Button one component), svg render size | colours |
| `P` paints | fill, gradient stops, stroke colour, text colour, opacity, shadow colour, svg stroke/fill colour, as token keys when `tok` is present else 8-bit RGBA + alpha rounded to 0.02 | geometry |

```js
function digest(v) {                      // returns {S,M,P,nodes,leaves,vis}
  if (v.t === 'text') return leaf(v, 'T' + (lines(v) > 1 ? 'm' : '1') + (v.n.ls?.tx?.tr ? 't' : '') + (v.n.runs ? 'r' : ''), fontM(v), paintOfText(v));
  if (v.t === 'svg')  return leaf(v, 'S', [Math.round(v.n.w), Math.round(v.n.h)], svgPaint(v));
  if (v.t === 'img')  return leaf(v, 'I' + (v.n.fit || ''), fixedBox(v), null);
  const ks = v.kids.map(digest);
  const flow = v.kids.filter(k => !k.abs);
  const S = H(['F', v.k, v.s.join(''), v.abs ? 'a' : '', v.n.clip ? 'c' : '', ...ks.map(d => d.S)]);
  const M = H([q(v.n.ls?.g), q(v.n.ls?.g2), (v.n.ls?.p || []).map(q), cornerQ(v.n), strokeW(v.n), shadowGeom(v.n),
               v.s[0] === 'F' ? q2(v.n.w) : '', v.s[1] === 'F' ? q2(v.n.h) : '', ...ks.map(d => d.M)]);
  const P = H([paintOf(v.n), ...ks.map(d => d.P)]);
  return { S, M, P, nodes: 1 + sum(ks, 'nodes'), leaves: sum(ks, 'leaves'), vis: vis(v) };
}
// q = round to integer; q2 = round to 2px grid; nested instance (after pass 1) is a leaf with S='C:'+id
```

Tolerance is NOT done by hashing (hash equality is exact). `M` and `P` are hashed only for fast exact buckets; near-identical merging is done in 1.4 on the numeric vectors kept next to each digest.

### 1.3 Candidate selection (what may become a component) and false-positive guards

A frame `v` is a *candidate* iff all hold:

1. `depth >= 2` below the screen root (the screen frame, the `div` root and `main` are never components). Overlay wrappers (`pos == 'fixed'` and size >= 90% of the screen) are not candidates, but their *children* (bottom sheet, dialog panel) are.
2. `2 <= nodes <= 120` and area <= 60% of the screen area. (A 62-node sidebar is fine; a whole page body is not.)
3. Not a synthetic frame: `ls.sp` (spacer `gap`), `align` wrappers made by normalize, `role in {gap, align}`.
4. Has interest: `styled` (fill/stroke/radius/shadow) **or** `role in {button, link, input, item, tab, alert, dialog, nav, aside, header, li, tr, th}`. A frame with only layout (no paint, role `div|span|p|section|form|list|label|bdi`, and a single child kind) is a *generic wrapper* and is never a candidate. (Measured: `F(T)|20`, a lone text frame, occurs 1963 times and must never be a component.)
5. Has at least one leaf (text, svg or img) in its subtree.
6. Not a pure container of N equal children whose count varies (`list`, `grid`, `tbody`): after item-level instancing in pass 1 such a frame is `F(C:x, C:x, C:x)`; its `S` includes the count, so it only repeats when the count repeats. It additionally needs `distinctKidKinds >= 2` or a `styled` surface, otherwise it is a layout container and stays a frame (section 1.8).
7. Complexity guard: if `nodes > 40` and mean pairwise `M`/`P` difference inside the cluster (1.4) is above 25% of numeric slots, the cluster is "data-shaped" (tables, charts, calendars) and is demoted to *report only*.

### 1.4 Clustering with tolerance, across all screens of all files

```text
pass 0   build views + digests for every screen of every file (streaming per file, keep only digests + paths, not trees; 59 MB total JSON, 91k nodes)
bucket   B[S]  = all candidates with the same S                                   // exact
leader   inside B[S], greedy leader clustering on the numeric M-vector under tolerance τM (below)  -> "cores"
variants inside a core, group by P-vector -> palette groups (sections 2.4, 4)
```

Numeric M-vector = values in DFS order. Distance is L-infinity per slot class with these tolerances (`τM`):

| Slot | Tolerance |
|---|---|
| gap, padding, stroke weight, radius corner, shadow offset/blur/spread | <= 1 px (so 9 vs 10 merge, 8 vs 10 do not) |
| fixed width/height | <= max(2 px, 2%) |
| font size | exact (11 and 12 are different styles) |
| line height | <= 1 px |
| letter spacing | <= 0.02 em |
| svg size | exact (stroke scaling differs, section 3) |

Colours (inside `P`): equal if same `tok` key; else CIEDE76 distance <= 1.5 and `|Δalpha| <= 0.02`. Leader choice: the member with the most members within tolerance (approximate medoid); the leader's exact values become the master; every other member records its deviation `dev = max |slot - leader|` (kept in `cmp.dev`, used by the review report and by verification, 5.6).

Streaming/memory: a first pass computes `S` and writes `{S, file, screenIdx, path, nodes}` per candidate to an array (91k nodes -> ~20k candidates), a second pass only reopens files for clusters that survive thresholds to extract exemplar subtrees.

### 1.5 Thresholds (all in `ds.config.json`, defaults below)

| Rule | Default |
|---|---|
| Minimum occurrences (cluster after tolerance merge) | tiny (`nodes < 6`): >= 4; otherwise >= 3; or >= 2 when `nodes >= 8` **and** it appears in >= 2 screens of different files |
| Minimum screens | >= 2 distinct screens (a repeated list row on ONE screen only is a component if occurrences >= 6) |
| Minimum confidence to generate | 55 (below: report only) |
| Hard excludes | by name regex list (`^(table|tbody|thead|form|main|section)$`), by config `exclude: ["path glob"]`, by owner decisions file (1.9) |

### 1.6 Naming

Name = `Group/Name` assembled from first available source:

1. Owner decision file / DS match (`ds.name`), e.g. `Button`.
2. Semantic role prefix of member names (the part before ` · `), voted by majority: `button -> Button`, `link -> Link`, `input -> Input`, `item -> List Item`, `tab -> Tab`, `alert -> Alert`, `aside -> Sidebar`, `header -> Header`, `tr -> Table Row`, `th/td` skipped. Table lives in `ds.config.json: nameHints.roles`.
3. aria-label / data-testid / `input#auth-identifier` style ids of members (walker already puts them in names): longest common prefix of ids with digits/uuids stripped.
4. Shape-based guess (project hint table): `{dim: 44, text+svg, radius pill}` -> `Pill`, circle with 1 text -> `Avatar`/`Badge`, `h<=28, radius 99, fill tint` -> `Badge`, `kheez 64px fixed-bottom` -> `Bottom Nav`. Config-extensible (`nameHints.shapes`).
5. Fallback: `Component <short hash>` and confidence penalty.

Variant suffix is not part of the name (it becomes variant properties, 2.4). Collisions get ` 2`, ` 3` and a report flag. Group = first token before `/`; defaults from role (`Buttons`, `Cards`, `Navigation`, `Lists`, `Forms`, `Feedback`, `Other`).

### 1.7 Nesting (a Card containing Buttons: nested instances)

Fixpoint over passes, innermost first:

```text
pass 1   candidates whose subtree contains NO other candidate cluster that passed thresholds (leaf-level components: Button, Badge, Avatar, ListItem...)
         -> accept clusters; in the in-memory views replace every member by a leaf  C:<cmpId>  (S contribution = 'C:'+id, M/P = its dev only)
pass 2   recompute digests for ancestors. A Card whose children are now  C:btn, T, C:badge  clusters with S including those ids.
         -> accept clusters; replace.
...      stop when a pass accepts nothing or after 4 passes
```

Because ancestors are hashed *after* children were replaced, a Card with two different Buttons variants still has one `S` (`C:btn` is variant-agnostic), and its `P` includes the nested variant value so different Button variants inside Cards are visible as Card palette groups (and become nested overrides, 2.7, instead of Card variants if the nested variant is a *content* choice: rule: a difference confined to nested instance variant props never creates a variant on the parent; it becomes an instance-level override of the nested instance, `ov` entry kind `inst`).

Absorption rule: if cluster X occurs only inside cluster Y (every X occurrence's ancestor is a Y member and the occurrence counts are equal), X is still created (it is a legitimate nested component) only if `X.screens >= 2` or `X.nodes >= 6`; otherwise it is merged into Y's master as plain structure. This avoids a component per repeated cell of a single table row.

### 1.8 Generic containers stay frames

A list of five Items is `Frame(Item, Item, Item, Item, Item)`: the frame is a plain frame with `layoutMode`, only the items are instances. The parent keeps its original sizing intent (`ls.s`), padding and gap. No information is lost because the instance overrides carry only content.

### 1.9 Confidence score and the review report

```js
function confidence(c) {                                     // 0..100
  const rep     = Math.min(1, Math.log2(c.occ) / 3);          // 8+ occurrences = 1
  const cross   = Math.min(1, c.screens / 4) * (c.files >= 2 ? 1 : 0.7);
  const size    = c.nodes < 3 ? 0.3 : c.nodes > 80 ? 0.5 : 1;
  const cohesion = 1 - Math.min(1, c.meanDev / 4);            // meanDev in px-equivalents from 1.4
  const semantic = c.nameSource === 'ds' ? 1 : c.nameSource === 'role' ? 0.9 : c.nameSource === 'shape' ? 0.7 : c.styled ? 0.5 : 0.2;
  let v = 100 * (0.22 * rep + 0.18 * cross + 0.10 * size + 0.25 * cohesion + 0.25 * semantic);
  if (c.hasAbsKids) v -= 10;           // absolute children make instance resizing fragile
  if (c.dataShaped) v -= 25;
  if (c.textOverflowRisk) v -= 10;     // fixed-width text slots with large length spread
  if (c.nested && !c.isNestedChild) v += 0;
  return Math.max(0, Math.round(v));
}
```

Bands: >= 80 `auto` (generated, no review needed); 55-79 `review` (generated, listed first in the report, marked with a yellow tag on the component description); < 55 `report-only` (not generated).

`out/enriched/components-report.json` (and `.md`, `.html`) per cluster:

```json
{ "id":"cmp_btn_3fa2", "name":"Button", "conf":87, "band":"auto", "occ":412, "screens":131, "files":22, "nodes":3,
  "nameSource":"role", "ds":{"match":"Button","score":0.71,"mode":"report"},
  "variants":{"Type":["Primary","Secondary","Ghost"],"State":["Default","Disabled"]},
  "slots":["Label (text)","Icon (swap)","Show icon (bool)"],
  "dev":{"mean":0.3,"max":1.5}, "examples":["athlete-settings/Settings/Default/390#4/1/0", "..."],
  "notes":["2 members have an extra icon: merged as BOOLEAN","8 members rejected: width tolerance"] }
```

The `.html` is a contact sheet: for each cluster its name, conf, counts, a rendering of 3 members side by side (reuse the HTML re-render of `diff.mjs`, called as a module; not modified), a table of what varies, and per-cluster controls (accept / reject / rename / "split by X" / "treat as variant of Y") that save to `component-decisions.json`. `componentize.mjs --decisions component-decisions.json` applies them on the next run (rejects become `exclude`, renames become `nameSource: 'owner'`, confidence = 100). This is the first manual-review hook (section 8).

## 2. Component generation in the plugin

Separate plugin `plugin-components/` (reads `_library.json`) builds the masters once; the existing import plugin (`plugin/code.js`) then only *instantiates*. The registry between them is the Figma document itself (2.1), so the two plugins and their authors never share code.

### 2.1 Where masters live, and the registry

- A page named `Kheez Components` (create if missing: `figma.createPage()` d.ts:447; loading other pages needs `figma.loadAllPagesAsync()`, `documentAccess: dynamic-page` in `plugin/manifest.json`, d.ts:8092-8129).
- One Section per library group (`Buttons`, `Cards`, `Icons` ...), laid out by a simple grid; components inside Sections (Section does not auto-resize, `gotchas.md:804`, so size it explicitly like `plugin/code.js` does at the end of the import).
- Each main component / component set is tagged: `node.setSharedPluginData('kheez','cmp', id)`, `('kheez','sig', S+M hash)`, `('kheez','ver', libVersion)`, `('kheez','conf', '87')` (d.ts:4152-4172). Lookup is one call: `page.findAllWithCriteria({ types:['COMPONENT','COMPONENT_SET'], sharedPluginData:{ namespace:'kheez', keys:['cmp'] } })` (d.ts:4704-4761); this is indexed and fast on big pages (d.ts:4704, `figma.skipInvisibleInstanceChildren = true` d.ts:60 for traversals). Result goes into `Map<cmpId, node>`.
- Idempotence: build only ids missing from the registry. If an id exists but `sig` differs, create a new node, rename the old `(superseded <date>)`, never delete.

### 2.2 Building a master

Reuse the existing `build()` instead of a second renderer; the master is "the exemplar subtree, built normally, then promoted":

```js
async function buildMaster(def, holder) {                   // def = library component or one variant member
  const tree = structuredClone(def.root);                    // exemplar subtree from _library.json
  rootSizing(tree);                                          // 2.3
  const frame = await build(tree, holder);                   // existing recursion: fills, auto-layout ladder, text, svg
  if (!frame) throw new Error('build failed');
  const comp = figma.createComponentFromNode(frame);         // d.ts:432: keeps properties and children; throws if the node is inside a component/instance
  comp.name = def.variantName || def.name;                   // 'Type=Primary, State=Default' for set members
  tag(comp, def);
  return comp;
}
```

`createComponentFromNode` preserves auto-layout and children (d.ts:416-432). Only after promotion are properties linked (they cannot be added before the node is a component): see 2.5. VERIFY E1 (does promotion keep `layoutSizing*`, text FILL widths and constraints exactly).

### 2.3 Root sizing of masters, resizing/fill/hug in instances

The master root has no auto-layout parent, so it cannot be `FILL`. `rootSizing(tree)`:

- Auto-layout root (`ls.k in H V W G`) whose `ls.s` axis is `H` or `L`: master axis `HUG` (primaryAxisSizingMode/counterAxisSizingMode `AUTO`, set via `layoutSizingHorizontal='HUG'` after children exist, `gotchas.md:618-668`).
- Axis `F` or root is `N`: `FIXED` at the leader's measured size.

Per occurrence the importer sets sizing on the *instance* exactly as it does for frames today (`sizeFrameLike`): `L -> layoutSizingHorizontal='FILL'` after `appendChild`, `H -> leave (hug)`, `F -> instance.resize(w,h)`. `resize()` before `layoutSizing*` (`gotchas.md:739`, SKILL rule 12c). An instance is a frame mixin so these are legal (d.ts:8742+ `InstanceNode extends DefaultFrameMixin`). For an `N` root (absolute children) the instance is only ever resized when the cluster's M-vector includes w/h (it does, because `F` axes are in `M`), so fixed instances are same-size by construction.

`FILL` children inside the master survive a resized instance by Figma's own constraint/auto-layout engine; text slots that were `HEIGHT` + FILL keep wrapping. Instance text that overflows a `FIXED`-width master slot is a known risk -> `textOverflowRisk` in confidence.

### 2.4 Variants: COMPONENT_SET

When a core (same `S`, `M` within tolerance) contains several palette groups, or when several cores of one `S` differ in a small discrete set of metrics, build one `COMPONENT_SET`.

**Slots that vary.** For every core compute the set of *varying slots*: pairs `(nodePathInMaster, field)` with field in `fill, stroke, textColor, opacity, shadowColor, svgColor` (paint) or `h, padding, fontSize, radius, w` (metric). For each slot get the partition of members by value (value = token key or quantised number).

**Property inference (algorithm).**

```js
function inferVariantProps(core) {
  const slots = varyingSlots(core);                                   // [{path, field, partition: Map(value -> memberIds)}]
  const groups = groupBy(slots, s => canonicalPartition(s.partition)); // identical (up to relabel) partitions co-vary = ONE property
  const props = [];
  for (const g of groups) {
    const kind = classify(g);                                         // 'Type' | 'State' | 'Size' | 'Tone' | 'Selected' | 'Style'
    const values = nameValues(g, kind);                               // see below
    props.push({ kind, values, slots: g });
  }
  // reject if: > 3 properties, > 24 combinations, a value used by a single member (-> instance override, not a variant)
  return prune(props);
}
```

Classification (first match wins), from the slot fields and the value semantics:

| Pattern | Property | Value names |
|---|---|---|
| root `opacity` in [0.3, 0.7] vs 1 | `State` | `Disabled` / `Default` |
| root stroke or fill moves to accent / accent@0.1-0.2 with text/icon to `accent-soft` | `State` or `Selected` (if the role is `tab|item|nav`) | `Selected` / `Default` (`Active` for nav items) |
| root stroke colour -> `coral`/`amber` token | `State` | `Error` / `Warning` |
| shadow `0 0 16 accent@0.25` appears | `State` | `Charged` (take the existing effect style name: `Glow/Violet Charge`) |
| root fill (+ text colour) changes among tokens | `Type` (use `Style` if the matched DS component uses that name) | via `variantNames` map: `accent->Primary`, `surface2->Secondary`, `transparent+line stroke->Outline`, `transparent->Ghost`, `coral->Danger`, `success->Success`, `amber->Warning`, `coach->Coach` (config) |
| only text colour or icon colour changes | `Tone` | token name tail (`Dim`, `Accent`, `Coral`...) |
| root height / vertical padding / font size changes (<= 4 distinct values) | `Size` | ranked by height: 2 values `Small/Medium`; 3 `Small/Medium/Large`; else `H36`, `H44` |
| anything else | `Variant` + `A`, `B`... and a review flag | |

Property and value names are normalised to Title Case (matches the existing DS: `Style x State`). If the cluster is matched to an existing DS component set (2.8) the DS property and value names are used instead.

**Optional parts -> BOOLEAN.** Two cores with the same ancestry but one lacks a leaf subtree (icon, badge, secondary text) are merged when child sequences reconcile: compute LCS over child `S` lists; if every member is a subsequence of one supersequence that adds <= 2 optional *leaf* nodes (svg/text/img) or one small frame, the supersequence is the master and each optional node gets a BOOLEAN property (`Show icon`, `Show badge`) bound via `componentPropertyReferences = { visible: key }` (cp.md:106-138). A hidden layer is excluded from auto-layout, so a missing icon renders as in the source (VERIFY E6 for HUG parents and `itemSpacing`).

**Building the set.**

```js
async function buildSet(def) {                                  // def.members: [{v:{Type:'Primary',State:'Default'}, root}]
  const comps = [];
  for (const m of def.members) {
    const c = await buildMaster({ ...def, variantName: Object.entries(m.v).map(([k,v]) => `${k}=${v}`).join(', '), root: m.root }, holder);
    addProperties(c, def.slots);                                 // TEXT/BOOLEAN/INSTANCE_SWAP BEFORE combine (cp.md:93-105)
    comps.push(c);
  }
  const set = figma.combineAsVariants(comps, page);              // d.ts:956; every member must be a ComponentNode
  layoutVariants(set, def.propsOrder);                            // grid by property values, then resizeWithoutConstraints from child bounds (cp.md:57-92, gotchas.md:507)
  set.name = def.name; tag(set, def);
  return set;
}
```

Variant names must be `Prop=Value, Prop2=Value2`, one member per combination; missing combinations are simply absent (the picker shows a blank; documented in cp.md:38-56). TEXT/BOOLEAN/INSTANCE_SWAP properties are created per member before combining; after combining the set inherits them (cp.md:93-105). Because the property key differs per member (`Label#12:0` vs `Label#13:0`), after combine read `set.componentPropertyDefinitions` and map by *name* (property names are the stable part; keys have a `#id` suffix, `gotchas.md:58`, `wwds-using`).

### 2.5 Overrides via component properties

Slots are determined at library time (on the leader) and numbered in DFS order. `_library.json` carries `slots[]`; the plugin maps `slotId -> property key / node path`.

| Slot kind | In the master | In an instance |
|---|---|---|
| `text` (varying across members) | `key = comp.addComponentProperty('Label','TEXT', defaultText)`; `textNode.componentPropertyReferences = { characters: key }` (cp.md:106-138) | `inst.setProperties({ [key]: 'ورود' })` (fonts must be loaded first: reuse `fontFor`; `wwds-using`, cp.md:356-420) |
| `text` with `runs` (mixed styling) | no property (a characters override resets ranges) | direct override: `textNode.characters = ...`, then re-apply `runs` (as `buildInner` does); counts as unmanaged text (cp.md:405-419) |
| `text` constant across all members | plain static text, no property | none |
| `bool` (optional part) | `addComponentProperty('Show icon','BOOLEAN', true)`; `child.componentPropertyReferences = { visible: key }` | `setProperties({ [key]: false })` |
| `swap` (svg occupying the slot with different icons) | the slot holds an **instance** of the default icon component; `addComponentProperty('Icon','INSTANCE_SWAP', iconComp.id)`; `inst.componentPropertyReferences = { mainComponent: key }` (cp.md:223-243) | `setProperties({ [key]: iconCompId })` (needs the component *node id* of the target, `wwds-using`) |
| `img` | rectangle with an image fill | direct sublayer override: `rect.fills = [imagePaint]` (fills are overridable on an instance sublayer). No property type exists for fills (`ComponentPropertyType` = BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT, SLOT, d.ts:8639) |
| `fill` / `stroke` outlier (value seen once or twice, not a variant) | none | direct sublayer override with the variable-bound paint (`setBoundVariableForPaint` returns a NEW paint, `gotchas.md:137`) |
| `inst` (nested instance with its own props) | `isExposedInstance = true` on the nested instance in the master (d.ts:8785) so its properties show on the parent | `nested = pathLookup(inst, path); nested.setProperties({...})` |
| `slot` (SLOT, free content area) | `comp.createSlot()` (cp.md:143-180) | `slot.appendChild(...)` |

Slot kind `SLOT` is only used when a region's *content structure* differs across members while the shell (padding, radius, fill) is identical (Card body, Bottom Sheet body). Restrictions in cp.md:215-222 (no GRID, nested slots...). It is P2; default is "shell + children become plain frames inside an instance" (a Card instance with its body children detached from the main component is not possible via the API, therefore `SLOT` or keep the body OUT of the component).

Addressing nodes in an instance without ids: instances mirror the master tree, so `path` (array of child indices from the instance root) is valid and stable; helper `at(inst, path)` walks `children`. No `findAll` per instance (cost, `gotchas.md:413-502`).

### 2.6 Creating instances in screens

Enriched screen node (section 7.1 contract):

```jsonc
{ "t":"frame","name":"button · ورود","x":16,"y":420,"w":358,"h":44,
  "cmp": { "id":"cmp_btn_3fa2", "v":{"Type":"Primary","State":"Default"},
           "ov":[ {"s":"0","t":"ورود"}, {"s":"1","b":false} ],
           "dev":0.4, "conf":87 },
  "ls": { "s":["L","F"] },
  "children":[ /* original subtree kept for old consumers; --slim strips it */ ] }
```

Plugin algorithm in `buildInner` (hook, before the generic frame path):

```js
async function tryInstance(n, parent) {
  const c = n.cmp; if (!c || !OPTS.useComponents) return null;
  const entry = REG.get(c.id); if (!entry) return null;                       // not in document -> fallback to frame
  const main = entry.kind === 'SET' ? pickVariant(entry.node, c.v) : entry.node;
  if (!main) return null;
  const inst = main.createInstance();                                           // d.ts:8707
  attach(parent, inst, n);                                                      // grid-aware append already exists
  postPlace(inst, n, parent);                                                   // position / ABSOLUTE / constraints
  sizeInstance(inst, n);                                                        // F -> resize, L -> FILL, H -> nothing
  await applyOverrides(inst, entry, c.ov);                                      // text props, bool props, swaps, fills, images
  const bad = verifyInstance(inst, n);                                          // 5.6
  if (bad) { inst.remove(); return null; }                                      // ladder rung R3: plain frame
  return inst;
}
```

`pickVariant(set, v)`: `set.children.find(ch => parse(ch.name) matches v)` (cp.md:325-343), cached in `Map(setId+JSON(v) -> ComponentNode)`. Variant swapping on an existing instance uses `inst.setProperties({Type:'Primary'})` (cp.md:344-355), but creating from the right child is cheaper.

Z-order/paint order: instances are appended in the same child order as frames, so `z` semantics are unchanged.

### 2.7 Images and fills

Images in masters hold the exemplar's image (or a neutral gray placeholder if the cluster has `img` slots with different sources). Instances override the rectangle's `fills` with `imagePaint(item, fit)` (existing function). Large inline `data` stay in the per-screen JSON; the library never carries image bytes (it stores `img` slots as `{kind:'img', fit, w, h}`). `figma.createImage` hashes dedupe identical bytes (existing `imageCache`).

### 2.8 Reusing the existing Design System components (Button, Card, ...)

Match is computed in Node (`dsmatch.mjs`) against an inventory exported from the live file (2.8.1). Never by name alone.

**2.8.1 Inventory export.** A command of `plugin-tokens/` (`Export inventory`) walks `Kheez Components` and `00 Design System` pages and writes `ds-inventory.json`: variables (id, key, name, collection, scopes, resolved value per mode), paint/text/effect styles (id, key, props), icon components (id, key, name, canonical SVG hash if the file keeps the source SVG in `setSharedPluginData('kheez','svg', canonical)`, else vector path data hash from `VectorPath`s), components/sets (id, key, name, property definitions, variant list, and a **fingerprint tree**: `{t, k, s, kids, fills: tokenOrRgba, radius, h, pad, gap}` using the same `view()` mapping as 1.1: FRAME/COMPONENT -> frame, TEXT -> text, VECTOR or frame-with-vectors -> svg, INSTANCE -> frame or `C:`). `ds-ledger.json` is an early hand-made subset of this and can seed it (names, ids, hex).

**2.8.2 Match score** between a cluster leader and a DS component (or each variant of a set):

```text
score = 0.40 * structure   // tree-similarity of S (matching child multiset + order; 1.0 if S equal)
      + 0.25 * metrics     // 1 - normalised |Δ| of h, padding, gap, radius, font size (tolerance as 1.4)
      + 0.20 * paints      // token-equal fills/strokes/text colours
      + 0.15 * name        // normalised role/name similarity (Button~button, Card~(div with radius 20 + surface fill))
```

`score >= 0.85` auto-match, 0.6-0.85 `review`, below none. Property names/values and the variant mapping (`ourVariant -> DS variant`) come from comparing paint partitions with each DS variant's fingerprint (e.g. our `Type=Primary` -> DS `Style=Accent`). Text slot maps to the DS TEXT property named like the label (`Label`), icon slot to the INSTANCE_SWAP property (`Icon`), optional icon to the BOOLEAN (`Show icon`).

**2.8.3 Modes** (`ds.config.json: dsMode`):

| Mode | Behaviour |
|---|---|
| `report` (default for the first run) | matches are listed; own generated components are used; nothing from the DS is instantiated |
| `prefer-ds` | instances are created from the DS component; every deviation > tolerance is fixed by instance-level overrides (resize, fills) and counted as `dsDeviation`; if the DS component cannot represent a member (variant missing) the member falls to an own component |
| `prefer-own` | DS is ignored (own components get DS-compatible names) |

Honest note: the DS was hand-built from `DESIGN.md` and later flagged "Cards & Overlays and Input Field regrid not visually screenshot-verified" in the ledger, and DESIGN.md disagrees with code on `radius/xl` (the ledger notes code wins). Expect mismatches between DS components and the real exported app; `report` first, decide per component.

**2.8.4 Import by key vs local lookup.**
- Same file (most likely, the DS lives on page `00 Design System` of the file that receives the export): local lookup. `figma.getNodeByIdAsync(ledger.id)` (d.ts:146) as a hint, verify by `name` and sharedPluginData, else scan with `findAllWithCriteria({types:['COMPONENT_SET']})` on the DS page after `loadAllPagesAsync`.
- Other file: `importComponentByKeyAsync(key)` / `importComponentSetByKeyAsync(key)` (d.ts:807, 811) only work for *published* library components (d.ts:6904: "you can only import components that are already published"). Batch with `Promise.all` (`gotchas.md:347`). Cross-file reuse therefore requires the DS file to be published as a team library. `UNVERIFIED`: whether the owner's plan (ledger says the MCP hit a "Starter-plan call limit") allows library publishing; if not, exports must land in the DS file. Strong recommendation: keep exports and the DS in one file.
- `component.key` exists on local components too but is not importable until published (d.ts:6904).

### 2.9 Failure ladder for components (never abort)

| Rung | Trigger | Action |
|---|---|---|
| R0 | all good | instance with overrides |
| R1 | override threw (font, property missing, swap target missing) | skip that override, flag `ovFail`, keep instance if bounds still verify |
| R2 | bounds/fill deviation (5.6) | fix with instance-level `resize`/fill override once, re-verify |
| R3 | still deviating, or component missing, or `createInstance` threw | remove the instance, build the plain frame from the retained children (the existing path) |
| R4 | master build failed in `plugin-components` | cluster marked `failed` in the registry log; screens use R3 |

Counters per rung are printed like the existing F0-F3 counters. `children` stay in the enriched JSON by default precisely so R3 is always possible; `--slim` removes them for size and then R3 degrades to an empty-named placeholder frame sized by `w/h` (explicitly not the default).

## 3. Icons

### 3.1 Canonical SVG hash

The walker writes a normalised SVG per node: root `viewBox`, size, computed colours on root and on children as attributes. Canonicalisation (`tools/ds/icons/svgsig.mjs`):

```js
function iconSig(svg) {
  const dom = parse(svg);                                                     // tiny XML parser
  const vb = viewBoxOf(dom) || [0, 0, w, h];
  const els = shapes(dom).map(e => [e.tag, ...DATTRS[e.tag].map(a => num(e.attrs[a]))]);   // path d | circle cx cy r | rect x y w h rx | line x1.. | polyline points
  const strokeOnly = !els.some(e => e.fill && e.fill !== 'none');             // stroke icon (Lucide) vs filled
  const geom = JSON.stringify({ vb: vb.map(round2), els: els.map(e => e.map(roundNum2)) });   // sorted path commands lowercased, numbers rounded to 2 decimals
  const style = JSON.stringify({ kind: strokeOnly ? 'stroke' : 'fill', sw: strokeOnly ? round2(rootStrokeWidth(dom)) : 0, cap: rootCap(dom), join: rootJoin(dom) });
  return { geom: sha1(geom).slice(0, 10), full: sha1(geom + style).slice(0, 10), vb, color: rootColor(dom) };
}
```

Identity = `geom` (+ `style` stroke width/caps as a secondary key). Colour and render size are excluded. Icon library: `{ id:'ic_<geom>', name, vb, kind, strokeWidth, color: dominant, sizes:{14:34,16:120,...}, svg:<canonical svg, colour = white or currentColor>, ds:{id,name}|null }`.

### 3.2 Names

Existing DS icon components (41) are named by Lucide names (`ChevronLeft`...). The ledger's `icons.json` holds their SVG strings. Match: `iconSig(ledger svg).geom == iconSig(node svg).geom` -> reuse the DS icon (`ds` field). New icons are named from a Lucide lookup table when available (`tools/ds/icons/lucide-names.json`, optional, generated from the lucide package at build time; `UNVERIFIED` that the app uses unmodified Lucide paths: the path `m15 18-6-6 6-6` equals Lucide `chevron-left` and ledger `ChevronLeft`, so very likely), else `Icon/<geom6>`.

### 3.3 Building and instancing

- Master per `(geom)`: `createNodeFromSvg(canonicalSvg)` at 24 (d.ts:922, `gotchas.md:995`), vectors' strokes/fills bound to the variable `icon/default` (or the primary `color` variable); wrapped as a component named `Icon/<Name>`. Existing 41 icon components are used as is when `ds` matched.
- Size: `createNodeFromSvg` honours the svg's width/height/viewBox, so strokes are scaled correctly at import (the current plugin relies on this). A resized *instance* does **not** scale stroke weight (resize scales geometry only; VERIFY E4). Therefore: for each icon, sizes with >= 5 uses become variants `Size=14/16/18/20` of an icon COMPONENT_SET built from SVGs generated at that size; other sizes use the nearest master + `strokeWeight` override on the nested vectors `sw * size / vbWidth`. Default if E4 shows the instance keeps proportional strokes: single master + resize.
- Colour per instance: nested vector paints are overridable on an instance. After `createInstance`, for the instance's `children` that are vectors (index path stored in `icons[].vecPaths`, usually `[0,0]` / one level), set `strokes`/`fills` with `setBoundVariableForPaint(paint,'color',iconVar)` where `iconVar` is chosen by role-aware lookup (`icon/dim`, `icon/accent-soft`, ... 4.5), skipping the write when the colour equals the master's. Cost-saving rule: group icon occurrences by (icon, colour) and, if one colour dominates (>= 60%), build the master with that colour bound.
- Where an icon sits inside another component (Button icon slot) it is an INSTANCE_SWAP slot (2.5); in plain frames it is a free instance node with `cmp:{id:'ic_...',kind:'icon', c:'icon/dim', sz:16}`.

## 4. Design system extraction (Node `tokens.mjs`, plugin `plugin-tokens/`)

### 4.1 Harvest

`tokens.mjs --in "out/**/*.figma.json" --tailwind ../ajdar/frontend/tailwind.config.js --inventory ds-inventory.json` walks every node once and counts, keeping `(count, screens, files, rolesHistogram)` per key:

| Family | Key | Source | Notes |
|---|---|---|---|
| colour | `c:rrggbb@aa` (aa = alpha*100, integer) | `fill`, `stroke.c`, `font.color`, `font.shadow.c`, `shadow[].c`, svg root/child `stroke`/`fill`, gradient stops | role = fill / text / stroke / icon / shadow / gradient-stop |
| gradient | `g:<type>:<angle>:<stops canonical>` | `layers[k=grad]`, `grads` | |
| text | `t:<family>/<size>/<weight>/<lh>/<ls_em>` | `font` (+ `runs` entries) | `ls` converted to em (`ls/size`, 0.275/11 = 0.025) |
| radius | `r:<tl>/<tr>/<br>/<bl>` collapsed to `r:16` when equal | `radius`, `radiusArr` | |
| spacing | `sp:<n>` | `ls.g`, `ls.g2`, `ls.p - ls.bw` (after the plugin's stroke subtraction) | ignore: `g > 128`, fractional `g` for SPACE_BETWEEN, negative values |
| effect | `e:` canonical sorted list of `inset,x,y,blur,spread,colorKey` | `shadow[]`, `blur`, `bblur` | multi-shadow stacks are one key |
| size | `sz:h<n>` for FIXED heights of interactive roles | `button|input` heights | feeds `size/*` variables (touch-min 44, header 56) |

### 4.2 Snapping near-equal values

```js
// colours: leader clustering in CIELAB, then alpha
function snapColors(entries) {                       // entries sorted by count desc
  const leaders = [];
  for (const e of entries) {
    const L = leaders.find(l => dE76(l.lab, e.lab) <= 1.5 && Math.abs(l.a - e.a) <= 0.02 && l.role === e.role);
    if (L) { L.members.push(e); L.count += e.count; } else leaders.push({ ...e, members: [e] });
  }
  return leaders;                                      // leader = most frequent exact value; members listed with their deviation
}
// text: equal family/size/weight; lh within 1px -> merge; ls within 0.02em -> merge
// numbers (radius, spacing): exact match to a token wins; else nearest token within 0.5px is "snap candidate", beyond that "off-scale"
```

Snapping *only merges measurement noise* (rounding of computed colours, 0.4 vs 0.4000001). It does not change geometry by default. Off-scale values (radius 9/9.5/14/22, gaps 1.63/3/6/10 not in token set) are listed under `findings` as design debt and keep their literal value (no binding).

### 4.3 Mapping to Tailwind tokens (meaningful names)

`tools/ds/tailwind.mjs`: `require()` the config (it is CommonJS), flatten `theme.extend.colors` (`accent.DEFAULT -> accent`, `accent.dk -> accent-dk`, `text -> text`), `borderRadius` (`xl:1rem -> 16`, `2xl -> 20`, `pill -> 99`), `fontFamily`, spacing (Tailwind default scale 1 = 4px; `spacing.4 = 16`), default font sizes with line heights (`text-sm = 14/20`, `text-xs = 12/16`). A colour matches a Tailwind token if `|Δ| <= 1/255` per channel; alpha variants map to `<token>/<alpha*100>` (Tailwind `bg-accent/10`). Result: `{ key:'c:8150e7@10', tailwind:'accent/10', semantic:'tint/accent-10' }`.

Semantic naming comes from (in order): matching variable in `ds-inventory.json` by *value and role scope*, then the project `tokenMap` in `ds.config.json` (`{"accent": {"fill":"bg/accent","text":"text/accent","icon":"icon/accent","stroke":"border/accent"}}`), then the generic rule `<roleprefix>/<tailwind name>` with role prefixes `bg/ text/ border/ icon/ effect/`. Preference: **semantic variable over primitive** always; primitives (`Primitives/*`) are only a fallback and only for the 135 existing ones (scopes `[]`, hidden, per ledger) when no semantic match exists, and each such use is reported.

### 4.4 `tokens.json` (report and plugin input)

```jsonc
{
  "version": 1, "generated": "2026-11-07T..", "source": { "files": 42, "screens": 443, "nodes": 91383 },
  "config": { "colorDeltaE": 1.5, "alphaTol": 0.02, "minUses": 3, "minScreens": 2 },
  "colors": [
    { "key": "c:191d24@100", "hex": "#191D24", "a": 1, "count": 2484, "screens": 310,
      "roles": { "fill": 2484 }, "tailwind": "surface2",
      "target": { "collection": "Color", "name": "bg/surface-2", "type": "COLOR", "scopes": ["FRAME_FILL","SHAPE_FILL"] },
      "existing": { "id": "VariableID:8:145", "name": "Color/bg/surface-2" }, "status": "bound" },
    { "key": "c:1c5552@60", "hex": "#1C5552", "a": 0.6, "count": 365, "tailwind": "coach/60",
      "target": { "collection": "Color", "name": "tint/coach-60" }, "existing": null, "status": "create" }
  ],
  "gradients": [ { "key": "g:linear:135:...", "count": 40, "target": { "style": "Gradient/accent" }, "status": "create" } ],
  "textStyles": [ { "key": "t:Vazirmatn/14/500/20/0", "count": 4532, "tailwind": "text-sm font-medium",
      "target": { "name": "Text/Body Medium" }, "existing": { "id": "S:...", "name": "Text/Body Medium" }, "status": "bound" } ],
  "radii": [ { "key": "r:16", "count": 8573, "tailwind": "rounded-xl", "target": { "collection": "Layout", "name": "radius/xl" }, "existing": {...}, "status": "bound" },
             { "key": "r:9", "count": 832, "status": "off-scale", "nearest": "radius/lg(8)" } ],
  "spacing": [ { "key": "sp:12", "count": 4014, "target": { "collection": "Layout", "name": "spacing/3" }, "status": "bound" } ],
  "effects": [ { "key": "e:0,0,16,0,8150e7@25", "count": 244, "target": { "style": "Glow/Violet Charge" }, "existing": {...}, "status": "bound" } ],
  "findings": [ "radius 9 used 832x, 9.5 160x: off-scale (nearest 8/10)", "text 11/lh13.75 645x: leading-[1.25] custom" ]
}
```

`status`: `bound` (exists, will be bound), `create` (missing and above `minUses` and `minScreens`), `review` (ambiguous: two variables share the value but different roles, or snapped from several members), `off-scale` (report only), `skip` (below thresholds).

### 4.5 Plugin: create or update (idempotent, with dry-run)

`plugin-tokens/` UI options: `Dry run (default on)`, `Create missing`, `Update values of existing (off)`, `Bind scope: components only / all screens`.

Lookup, never duplicate:
1. Variable: by `getVariableByIdAsync(existing.id)`; else by shared plugin data `kheez.tokenKey == key` over `getLocalVariablesAsync()`; else by `collection.name + '/' + name`. Found -> reuse (update value only when `Update values` is on and differs; never delete).
2. New collection only if the target collection does not exist (existing: `Primitives`, `Color`, `Layout`; new tokens go to existing collections following the established naming; unmapped values go to a new collection `Imported (review)` with a single mode `Value`, `gotchas.md:149, 898`).
3. Created variables set scopes explicitly (`gotchas.md:857`, scopes list d.ts:9201): bg/fill `["FRAME_FILL","SHAPE_FILL"]`, text `["TEXT_FILL"]`, border `["STROKE_COLOR"]`, icon `["SHAPE_FILL","STROKE_COLOR"]`, effect colour `["EFFECT_COLOR"]`, radius `["CORNER_RADIUS"]`, spacing `["GAP"]`, size `["WIDTH_HEIGHT"]`; code syntax `WEB` = Tailwind key (`variable.setVariableCodeSyntax('WEB','colors.surface2')`, d.ts:9426, as the ledger already does).
4. Semantic variable values for colours with alpha: COLOR variable values carry `a` (vp.md:35-72); alias to a primitive when the base colour exists in `Primitives` (`VARIABLE_ALIAS`, vp.md:159-172) so the chain Primitives -> Color is preserved.
5. Text styles: index `getLocalTextStylesAsync()` (d.ts:710) by `family|style|size|lh|ls`; match -> bind; missing and above thresholds -> `figma.createTextStyle()` (d.ts:679), `await figma.loadFontAsync`, `fontName`, `fontSize`, `lineHeight={unit:'PIXELS',value}`, `letterSpacing={unit:'PERCENT'|'PIXELS'}` (objects, not numbers, `gotchas.md:297`), name by the existing convention (`Text/<Role> <size> <Weight>`), `setSharedPluginData('kheez','tokenKey', key)`.
6. Effect styles: `figma.createEffectStyle()` (d.ts:685), effects array, colour variable bound with `setBoundVariableForEffect(effect,'color',var)` (d.ts:1227; returns a new effect).
7. Gradient paints: `figma.createPaintStyle()` (d.ts:673). Gradient stops can carry a bound variable (`ColorStop.boundVariables`, d.ts:2507-2521; call form `UNVERIFIED`, E12).

**Dry-run** performs every lookup and prints the same `tokens.json` statuses with real ids: "would create 14 variables (list), would create 3 text styles, would bind 18,230 fills", and writes a `kheez-dry-run.json` into the UI for download. No `create*`, no `set*` is called when dry-run is on (guard in one wrapper `W.create(kind, fn)`).

**Binding** (inside the import plugin and for components in `plugin-components`): replace the exact-RGBA map `loadColorVariables` by a keyed map `tokenKey -> Variable` built from `tok` keys (section 7.2) so binding no longer depends on re-matching floats, and so the *role* decides which variable of equal value is used (today the scoring is `Color` > other > `Primitives` only). Bindings by field: fills/strokes `setBoundVariableForPaint` (d.ts:1215), gap `setBoundVariable('itemSpacing',v)`, `counterAxisSpacing`, padding four fields, corner radii individual corners `topLeftRadius...` (vp.md:87-120), `strokeWeight`, text style `await t.setTextStyleIdAsync(id)` (d.ts:8572; batches of 100 with `Promise.all`), effect style `await n.setEffectStyleIdAsync(id)` (d.ts:5179). Text style first, then re-apply `runs` ranges (a style write replaces range overrides; VERIFY E11). Bind only when the value the plugin actually sets equals the variable's value (e.g. padding after `bw` subtraction).

**Scope of binding**: default `components only` (masters carry the bindings; instances inherit them; reduces binding calls by roughly the fraction of nodes inside components, expected 50%+ by the prototype numbers: instances' 22k nodes-equivalents of 91k). `all` binds every remaining frame in screens.

### 4.6 Idempotence and naming rules

- Every created variable/style carries `sharedPluginData('kheez','tokenKey', key)` and `('kheez','tokensVer', hash)`. Re-running finds by key, then by name, and does nothing if equal.
- Names: variables `<role>/<name>` lower-kebab (`bg/surface-2`, `text/dim`, `tint/accent-15`, `border/accent-40`), numeric `spacing/<tw index>` (`spacing/3`), `radius/<tw name or px>`, `size/<name>`; text styles `Text/<Role> <size> <Weight>`, `Display/...`, `Mono/...` (existing); effects `Glow/..`, `Ring/..`, `Shadow/<sm|md|..>`. Collisions get `-2` and a `review` finding.
- Never rename or delete existing variables/styles/components; the plugin only adds and (opt-in) updates values.

## 5. Pipeline

```text
extract.mjs -> out/*.figma.json (+ ls)                                   [exists]
tokens.mjs        --in out/**/*.figma.json  --tailwind ... --inventory ds-inventory.json   -> out/enriched/tokens.json  +  out/enriched/tok-annotations (in memory) 
plugin-tokens     (Figma) dry-run -> apply tokens.json; "Export inventory" -> ds-inventory.json
componentize.mjs  --in out/**/*.figma.json --tokens out/enriched/tokens.json --inventory ds-inventory.json --decisions component-decisions.json
                  -> out/enriched/_library.json, out/enriched/<file>.figma.json (adds cmp/tok), components-report.{json,md,html}
plugin-components (Figma) _library.json -> "Kheez Components" page (masters, sets, icons), registry tags
plugin (import)   enriched/<file>.figma.json -> screens with instances + token bindings; verification report
expand.mjs        enriched -> expand cmp back into plain trees; compare with the original JSON (Node round trip)
```

### 5.1 Why `tokens.mjs` runs first

`componentize.mjs` compares paints by token key (exact), so palette groups are crisp (no float noise) and variant naming can use semantic names. If `tokens.json` is missing it falls back to RGBA quantisation (alpha 0.02).

### 5.2 Backward compatibility

All additions are optional per-node fields: `cmp`, `tok`. Older plugin builds ignore them and build the retained `children`. Enriched files are written to `out/enriched/` (originals untouched). `cmp.stripped` / `--slim` is opt-in. `_library.json` is global; per-file JSON refers to it by `id`. `kheezFigma` stays `1`; add top-level `ds: { library: "_library.json", tokens: "tokens.json", ver: 1 }`.

### 5.3 Incremental runs

`componentize.mjs --prev out/enriched/_library.json` keeps ids: new clusters are matched to previous ones by `S` equality first, then by member overlap (>= 60% of paths), so Figma masters and their instances stay linked across exports. Ids are `cmp_<slug>_<hash4(S of the first accepted leader)>`.

### 5.4 Performance (target ~500 screens, ~100k nodes)

Node side (measured scale: 59 MB JSON, 91,383 nodes): digesting is linear; load files one at a time, keep digests only. Expected seconds, not minutes (`UNVERIFIED` timing).

Figma side. Everything below is `UNVERIFIED` until E3/E8 and uses only API facts from the typings:

- Per node API calls dominate. An instance replaces a subtree of N nodes with one `createInstance()` (d.ts:8707) plus K overrides, so a cluster of 22,146 instances x ~5 nodes avoids roughly 100k node creations. Expected net faster, E3 measures it.
- Yield to the UI every ~40 nodes (existing `bump`), use one Section per file (existing), 25 screens per run; huge pages slow Figma itself, so offer `Page per batch` (`OPTS.pagePerBatch`).
- `figma.skipInvisibleInstanceChildren = true` (d.ts:60) before any traversal; use `findAllWithCriteria` on small receivers (`gotchas.md:413-502`), never `findAll` on a screen.
- Async calls (`setTextStyleIdAsync`, `getNodeByIdAsync`, `importComponent*ByKeyAsync`, `loadFontAsync`) batched with `Promise.all` in pools of 50-100 (`gotchas.md:347`).
- Instances: cache `ComponentNode`s per `cmpId` and per variant key; compute override lists in Node (no inference at build time); text overrides need fonts loaded once per (family, style) (existing `fontFor` cache).
- Bindings: `Variable` objects cached by token key; avoid `getLocalVariablesAsync` per node.

### 5.5 Failure ladder (summary)

Tokens: variable not found -> keep literal colour (current behaviour); style not found -> literal font props. Components: section 2.9. Library: master build error -> cluster skipped, screens use plain frames. Every step is wrapped by the existing `safe()`; nothing aborts the import.

### 5.6 Verification: instances must render identically

1. **Node round trip (no Figma)**: `expand.mjs` re-inflates each `cmp` from `_library.json` + overrides into a plain tree and compares against the original screen JSON: per node `|dx|,|dy|,|dw|,|dh| <= 1.5` for geometry the `ls` simulator can compute (use `layout-sim.mjs`), fills equal within snap tolerance, text equal, same child counts. Fail -> cluster member excluded (`cmp.rejected: 'roundtrip'`), recorded in the report. This catches clustering errors before Figma.
2. **Figma bounds check** (`verifyInstance`): after the instance is appended and overrides applied, compare `inst.width/height` and the first-level children bounds with the source rectangles using the same tolerance scheme as `evalDev` (text drift budget); compare solid fill colours of the instance and its text children with the source (`|Δ|<=1/255`, alpha 0.02) unless a `tok` binding replaced the value.
3. **Diff report** `ds-verify.json` written by the plugin UI: per cluster `{ instances, ok, resizedFix, fellBack, maxDW, maxDH, colourMismatches }`, plus worst 20 instances with screen name and path.
4. **Visual regression (P2)**: build each screen twice (plain, componentized) in two sections, `exportAsync({format:'PNG'})` both, decode in the UI iframe canvas and compute the pixel diff percentage like `diff.mjs` does; any screen above 1% is listed.
5. **Mock**: extend `plugin-mock.mjs` (a new file `plugin-mock-ds.mjs`, not the existing one) with `createComponentFromNode`, `createInstance`, `combineAsVariants`, `setProperties` to run the whole pipeline in CI; it catches API misuse, not rendering.

## 6. Section map

Task item 2 (generation, reuse of existing DS components) is sections 2.1-2.9; item 6 (limits, review hooks, generalisation) is section 8; item 7 (plan, experiments) is sections 9-10. Section 7 below holds the data contracts.

## 7. Data contracts

All objects are JSON, additive. `id`s are strings. Field `v` = variant property map, `ov` = overrides, `s` = slot id (string path, `"2"` or `"2.1"` for a slot inside a nested instance).

### 7.1 Screen node additions (written by `componentize.mjs`)

```ts
interface CmpRef {
  id: string;                          // library component id ('cmp_...' or icon 'ic_...')
  v?: Record<string,string>;           // variant property values for COMPONENT_SET members
  ov?: Override[];                     // content differing from the master default
  sz?: [number|null, number|null];     // optional explicit size when ls.s axis is 'F' and differs from the master
  dev?: number;                        // max deviation (px-equivalent) from the leader, informational
  conf?: number;                       // cluster confidence 0..100
  rej?: string;                        // 'roundtrip' | 'tolerance' ... set when the member was left as a plain frame
  stripped?: boolean;                  // children removed by --slim
}
type Override =
  | { s: string; t: string }                                   // TEXT property value (or direct text for runs: also r: runs)
  | { s: string; b: boolean }                                  // BOOLEAN visible
  | { s: string; ic: string; c?: string; sz?: number }         // INSTANCE_SWAP to icon id, optional colour token key and size
  | { s: string; img: { asset?: string; data?: string; fit?: string; tf?: number[][] } }
  | { s: string; fill?: RGBA; fillTok?: string; stroke?: RGBA; strokeTok?: string; op?: number }
  | { s: string; v: Record<string,string> };                   // nested instance variant props

interface TokRef {                      // keys refer to tokens.json entries
  f?: string; s?: string;               // fill / stroke colour key  'c:191d24@100'
  tx?: string;                          // text colour key (TEXT nodes)
  ts?: string;                          // text style key 't:Vazirmatn/14/500/20/0'
  r?: string;                           // radius key 'r:16'
  g?: string; g2?: string;              // gap keys 'sp:12'
  p?: (string|null)[];                  // padding keys [t,r,b,l] (after bw subtraction)
  e?: string;                           // effect style key
  sw?: string;                          // stroke weight key
  gr?: { i: number; key: string }[];    // gradient layers
}
// node.cmp?: CmpRef;  node.tok?: TokRef;   (any node)
```

### 7.2 `_library.json`

```ts
interface Library {
  version: 1; generated: string; params: object;
  components: LibComponent[]; icons: LibIcon[];
}
interface LibComponent {
  id: string; name: string; group: string; conf: number; band: 'auto'|'review';
  nameSource: 'owner'|'ds'|'role'|'aria'|'shape'|'hash';
  ds?: { id?: string; key?: string; name: string; score: number; mode: 'report'|'prefer-ds'|'prefer-own';
         propMap?: Record<string,string>; variantMap?: Record<string,string>[] };
  root: Node;                           // exemplar subtree (same schema as screens; text from the leader; img slots without data)
  slots: { s: string; kind: 'text'|'bool'|'swap'|'img'|'fill'|'inst'|'slot'; path: number[]; name: string;
           default?: string|boolean; prop?: string; fixedRuns?: boolean }[];
  variants?: { props: Record<string,string[]>; members: { v: Record<string,string>; root: Node; n: number }[] };
  stats: { occ: number; screens: number; files: number; devMean: number; devMax: number };
  notes?: string[];
}
interface LibIcon {
  id: string; name: string; geom: string; vb: number[]; kind: 'stroke'|'fill'; strokeWidth?: number;
  svg: string; sizes: Record<string,number>; vecPaths: number[][]; ds?: { id?: string; name: string };
  dominantColor?: string;               // token key
}
```

### 7.3 `ds-inventory.json` (written by `plugin-tokens` "Export inventory")

```ts
{ file: string; generated: string;
  collections: {id,name,modes:{id,name}[]}[];
  variables: {id,key,name,collection,type,scopes:string[],valuesByMode:Record<string,any>,codeSyntax?:Record<string,string>}[];
  paintStyles: {id,key,name,paints}[]; textStyles: {id,key,name,fontName,fontSize,lineHeight,letterSpacing}[]; effectStyles: {id,key,name,effects}[];
  components: {id,key,name,type:'COMPONENT'|'COMPONENT_SET',page,props:Record<string,{type,defaultValue,variantOptions?}>,variants?:string[],fingerprint:object}[];
  icons: {id,key,name,geom?:string}[] }
```

### 7.4 `ds.config.json` (project-specific, section 8)

```jsonc
{ "tailwind": "../ajdar/frontend/tailwind.config.js",
  "thresholds": { "occ": 3, "screens": 2, "minConf": 55, "colorDeltaE": 1.5, "alphaTol": 0.02 },
  "tokenMap": { "accent": { "fill":"bg/accent","text":"text/accent-soft","icon":"icon/accent-soft","stroke":"border/accent" } },
  "nameHints": { "roles": { "button":"Button","item":"List Item","aside":"Sidebar","tr":"Table Row" },
                 "shapes": [ { "match": {"h":64,"fixedBottom":true}, "name":"Bottom Nav" } ] },
  "variantNames": { "fill": { "accent":"Primary","surface2":"Secondary","coral":"Danger" } },
  "fontMap": { "Vazirmatn": "Vazirmatn", "Space Grotesk": "Space Grotesk", "JetBrains Mono": "JetBrains Mono" },
  "dsMode": "report", "exclude": ["*/Admin/*/table*"], "scope": "components" }
```

## 8. Honest limits, manual-review hooks, generalisation

### 8.1 What the tool cannot decide (a designer must)

- **Semantics.** Whether two visually identical things are the same component (a "Card" vs a "Settings row" with the same box) or two different ones that should diverge later.
- **Variant intent.** Static captures show states that occurred (disabled, selected, error), not hover/pressed/focus unless a screen captured them. Variant names are heuristics; wrong guesses (`Variant A`) are flagged.
- **Content vs component.** Which text is a property, which part is a SLOT.
- **Responsive.** Captures are per width (390, 1280): the same component at two widths becomes one component only if `ls.s` makes the width free; breakpoint behaviour is not inferred.
- **Behaviour.** No interactions, no prototyping, no real hover/active styles, animations or truncation rules beyond `tr`.
- **Token semantics.** `#99a0ab` as `text/dim` vs `icon/dim` is chosen by role; colours used for several meanings need a human decision (`review` status).
- **Off-scale values** (radius 9/14/22, odd gaps) are reported, never snapped automatically.
- **Chrome vs Figma text metrics.** Instances can differ in height by a few px when text wraps differently; the ladder (R2, R3) handles but does not erase that.
- **Matching the existing DS** may expose that the hand-built DS does not equal the app; the first run is `report`.
- **Library publishing** (cross-file reuse) depends on the Figma plan `UNVERIFIED`.

### 8.2 Review hooks

1. `components-report.html` + `component-decisions.json` (accept/reject/rename/merge/split) applied on the next `componentize.mjs` run (1.9).
2. `tokens.json` `review` statuses edited by hand (target name, role) and re-fed with `--overrides tokens-overrides.json`.
3. Plugin dry-run for tokens and components (`plugin-components` has the same `Dry run` switch: lists masters it would create).
4. Band tags on component descriptions (`review` = yellow) and `kheez.conf` plugin data.
5. `ds-verify.json` worst-offenders list.

### 8.3 What is project-agnostic and what is per-project

| Agnostic (reuse for any React/Tailwind project) | Per-project config |
|---|---|
| JSON schema (`ls`, `cmp`, `tok`), digests, clustering, tolerance, nesting fixpoint, confidence, variant inference algorithm | `ds.config.json`: thresholds, excludes |
| Icon canonicalisation (any SVG icon set) | Lucide name table (optional), per-project icon colour variable names |
| Token harvest, snapping, status model, idempotent creator, dry-run | `tailwind.config.js` path (or `--css-vars file.css` parser for shadcn-style projects, P2), `tokenMap`, naming convention of the existing collections |
| Plugin instancing, overrides, ladder, verification | Fonts and `fontMap` (this project: Vazirmatn/Space Grotesk/JetBrains Mono; RTL ordering is already handled by `normalize.mjs`) |
| Registry via shared plugin data | Role-prefix table (`nameHints.roles`), variant value dictionary (`variantNames`), group names, DS match mode |

Principle for generalisation: no colour, name or font literal in code; every project-specific string lives in `ds.config.json` or in `tailwind.config.js`. Package as `kheez-ds` (Node CLI: `ds tokens`, `ds components`, `ds expand`) plus the two Figma plugins. RTL specifics (ordering by visual x) are upstream in `normalize.mjs`, so downstream steps are direction-agnostic.

## 9. Experiments to run in real Figma first (extend `plugin/verify/`, new plugin `plugin/verify-ds/`)

Run in a scratch file with Vazirmatn installed. Each prints a JSON result and a ready-to-paste `CFG` block (same style as `docs/VERIFY-IN-FIGMA.md`). All nodes are removed at the end.

| # | Question | Method | Decides |
|---|---|---|---|
| E1 | Does `createComponentFromNode` keep `layoutMode`, `layoutSizing*`, text FILL widths, `strokesIncludedInLayout`, constraints, `layoutPositioning=ABSOLUTE` children exactly? | build a frame with the existing `build()` on a fixture node (Button, Card with abs child), promote, compare property snapshots before/after | `buildMaster` as promote-after-build |
| E2 | Instance sizing: HUG master + `resize` on instance, `layoutSizingHorizontal='FILL'` on an instance inside an auto-layout parent, text property longer than default (hug growth), RTL string | create, set, read sizes | 2.3 |
| E3 | Throughput: 1,000 manual builds of an 8-node Button vs 1,000 `createInstance()`+setProperties | `performance.now()`, with and without appending to a Section | go/no-go and batch size |
| E4 | Nested vector paint override inside an instance (`strokes` with bound variable); stroke weight after instance `resize` 24->14; overriding `strokeWeight` on nested vectors | icon master from `createNodeFromSvg`, instances | 3.3 |
| E5 | `addComponentProperty` before `combineAsVariants` keeps properties on the set; missing variant combinations; property name reuse across members | 2x2 set with one hole | 2.4 |
| E6 | BOOLEAN `visible=false` child in a HUG auto-layout with `itemSpacing`: does the gap collapse? | measure widths | optional parts |
| E7 | `isExposedInstance` on nested instance; setting nested props from the parent instance; INSTANCE_SWAP via `setProperties` with component id | Card containing Button | 2.5 |
| E8 | Cost of `setBoundVariable` / `setBoundVariableForPaint` calls (10,000 calls) and of `setTextStyleIdAsync` in pools of 100 | timings | scope `components` vs `all` |
| E9 | `findAllWithCriteria({sharedPluginData})` across pages after `loadAllPagesAsync`; `getNodeByIdAsync` for a node on an unloaded page under `dynamic-page` | | registry design, 2.8.4 |
| E10 | `importComponentByKeyAsync(localComponent.key)` for an unpublished local component | expect failure | confirms library publishing requirement |
| E11 | `setTextStyleIdAsync` on a text with `setRangeFontSize`/`setRangeFills` runs: are ranges kept? On a node with a bound fill variable: kept? | | order of style application and runs |
| E12 | Effect style creation with bound colour variable; gradient stop `boundVariables` assignment form | | 4.5 items 6-7 |
| E13 | Text style `letterSpacing` PERCENT vs PIXELS rounding for `0.025em`; `lineHeight` PIXELS 16.5 stored exactly? | | text style fidelity |
| E14 | Variable scopes persisted; `valuesByMode` alias chain Primitives -> Color; code syntax | | 4.5 |
| E15 | Instance paint order, `clipsContent`, `blendMode`, `opacity` preserved at instance level; `xf` (rotation) on instance root | | which nodes can be instances |
| E16 | `swapComponent` vs `mainComponent` assignment for variant switching; cost | | 2.6 |
| E17 | `combineAsVariants` with 24 members: time and layout helper; set resize | | limits 2.4 |
| E18 | Component inside a Section on a page: appears in Assets; `description` / `documentationLinks` for conf tags | | 2.1 |
| E19 | Plugin manifest with several `menu` commands and `figma.command` (for plugin-tokens: Export inventory / Dry run / Apply) | | `UNVERIFIED` syntax, alternatively three small plugins |
| E20 | Vazirmatn text with TEXT property: width recomputation and `textAutoResize` kept in instance | | 2.5 |

Test-plugin outline (`plugin/verify-ds/code.js`):

```js
figma.showUI(__html__, { visible: false });
const R = {};                                         // results
const cleanup = [];
const mk = (n) => { cleanup.push(n); return n; };
const timed = async (name, fn) => { const t = Date.now(); try { R[name] = await fn(); } catch (e) { R[name] = { error: String(e && e.message || e) }; } R[name + '_ms'] = Date.now() - t; };

await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
try { await figma.loadFontAsync({ family: 'Vazirmatn', style: 'Regular' }); } catch (e) { R.noVazir = true; }

await timed('E1', async () => {
  const f = mk(figma.createFrame()); f.layoutMode = 'HORIZONTAL'; f.itemSpacing = 8; f.paddingLeft = f.paddingRight = 12;
  const t = figma.createText(); f.appendChild(t); t.characters = 'Button'; t.textAutoResize = 'WIDTH_AND_HEIGHT';
  f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
  const before = snap(f), c = figma.createComponentFromNode(f); mk(c);
  return { before, after: snap(c), same: JSON.stringify(before) === JSON.stringify(snap(c)) };
});
await timed('E3', async () => {
  const c = makeButtonComponent(); const holder = mk(figma.createFrame()); holder.layoutMode = 'VERTICAL';
  const t0 = Date.now(); for (let i = 0; i < 1000; i++) holder.appendChild(c.createInstance()); const inst = Date.now() - t0;
  const t1 = Date.now(); for (let i = 0; i < 1000; i++) holder.appendChild(buildButtonManually()); const man = Date.now() - t1;
  return { instancesMs: inst, manualMs: man };
});
// E4..E20 follow the same pattern: build a minimum fixture, perform the call, snapshot the relevant properties
for (const n of cleanup.reverse()) try { n.remove(); } catch (e) {}
figma.ui.postMessage({ type: 'result', json: JSON.stringify(R, null, 2), cfg: cfgFrom(R) });
```

`snap(n)` returns `{layoutMode, itemSpacing, padding*, primaryAxisSizingMode, counterAxisSizingMode, layoutSizingHorizontal, layoutSizingVertical, width, height}`; `cfgFrom(R)` maps results to `CFG` flags (`useInstanceSizing`, `exposeNested`, `iconStrokeScaleOnResize`, `bindScope`, `registryCrossPage`).

## 10. Prioritised implementation plan

Work split so that agents do not touch the same files. Each task lists owned paths. Contracts are section 7; task T1 delivers machine-readable schemas and fixtures first so the rest can start the same day against fixtures.

### P0 (first usable result: tokens bound, repeated leaf components with text overrides, icons)

| Task | Owner paths | Depends on | Delivers |
|---|---|---|---|
| T0 Experiments | `plugin/verify-ds/*`, `docs/VERIFY-DS-IN-FIGMA.md` | none | E1-E8, E11, E20 answers + `CFG` block (run by the owner) |
| T1 Contracts and fixtures | `docs/ds-schema/*.schema.json`, `tools/ds/common/*` (hash, colour, view, validate), `fixtures/ds/{tokens.json,_library.json,enriched-sample.figma.json,ds-inventory.json}` | none | JSON schemas, validators, hand-written fixtures consistent with section 7 |
| T2 Token harvest | `tokens.mjs`, `tools/ds/tokens/*` | T1 schemas | `tokens.json`, `findings`, Tailwind mapping, `tok` annotations in enriched output (writer module `tools/ds/tokens/annotate.mjs`) |
| T3 Tokens plugin | `plugin-tokens/*` (manifest, code.js, ui.html) | T1 fixtures | dry-run, create-if-missing variables/text/effect styles, inventory export, idempotence |
| T4 Component detector core | `componentize.mjs`, `tools/ds/components/{view,digest,cluster,nest,name,confidence,library}.mjs` | T1 | passes 1-4, tolerance clustering, naming, confidence, `_library.json` (no variants), enriched JSON with `cmp.id` + text overrides only |
| T5 Icons | `tools/ds/icons/*` | T1 | `iconSig`, icon clustering, DS icon match from ledger/inventory, `icons[]` in the library |
| T6 Components plugin | `plugin-components/*` | T1 fixtures | registry, `Kheez Components` page, masters, TEXT/BOOLEAN/INSTANCE_SWAP properties, icon components, dry-run |
| T7 Import plugin integration | `plugin/code.js`, `plugin/ui.html` (single owner) | T1 fixtures, T6 conventions | `tryInstance`, overrides, token binding by key, verify + ladder R0-R3, stats, `Use components` / `Bind tokens` options; legacy path untouched when fields absent |
| T8 Round-trip verifier | `expand.mjs`, `tools/ds/verify/*` | T1, T4 | Node `expand` + compare (5.6.1), run in CI over `out/` |

### P1

| Task | Owner paths | Depends on |
|---|---|---|
| T9 Variants and optional parts | `tools/ds/components/variants.mjs` (called from `componentize.mjs` through one exported hook `inferVariants(core)`) and `plugin-components/variants.js` | T4, T6 |
| T10 Existing DS matching | `tools/ds/components/dsmatch.mjs`, `docs` fingerprint writer in `plugin-tokens/inventory.js` | T3 inventory, T4 |
| T11 Review report | `report.mjs` (HTML contact sheet, reuses `diff.mjs` as a module read-only), decisions file reader in `tools/ds/components/decisions.mjs` | T4 |
| T12 Binding extras | `plugin/code.js` sections for gap/padding/radius/stroke/effect/text styles (same owner as T7), `tools/ds/tokens/annotate.mjs` extensions | T2, T3 |
| T13 Incremental ids | `tools/ds/components/prev.mjs` | T4 |

### P2

| Task | Notes |
|---|---|
| T14 SLOT support, nested exposure polish | after E7 |
| T15 Visual regression in plugin UI | 5.6.4 |
| T16 `--slim` enriched output and library size optimisation | |
| T17 Generalisation | `ds` CLI packaging, `--css-vars` token parser, Lucide name table generator, config schema |
| T18 Breakpoint-aware variants (390 vs 1280) | |
| T19 Gradient paint styles and stop variable binding | after E12 |
| T20 `plugin-mock-ds.mjs` | CI mock of instance APIs |

Parallelism: T0, T1 start immediately; after T1 (hours), T2, T3, T4, T5, T6, T7(partial against fixtures) can run in parallel; T8 follows T4; P1 tasks plug into hooks that P0 tasks expose (`inferVariants`, `matchDs`, `decisions`).

## 11. Typings and docs relied on (index)

| Topic | Reference |
|---|---|
| `createComponent`, `createComponentFromNode` | `d.ts:408-434` |
| `combineAsVariants` | `d.ts:940-959`; `cp.md:38-92`; `gotchas.md:507-533` |
| Component properties (add/edit/delete, definitions, `componentPropertyReferences`) | `d.ts:7160-7360`; `cp.md:93-138` |
| `ComponentPropertyType` (BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT, SLOT) | `d.ts:8639` |
| `InstanceNode`: `createInstance`, `setProperties`, `swapComponent`, `mainComponent`, `exposedInstances`, `isExposedInstance`, `overrides`, `removeOverrides`, `detachInstance` | `d.ts:8690-8800` |
| Slots | `cp.md:139-222` |
| INSTANCE_SWAP pattern | `cp.md:223-243` |
| Library import by key and the "published only" limit | `d.ts:807-815`, `d.ts:6904`; `cp.md:305-324`; `wwds-using` |
| Instance text overrides, variants selection | `cp.md:325-420`; `wwds-using` |
| `setBoundVariableForPaint` / `ForEffect` / node `setBoundVariable` | `d.ts:1215-1230`, `d.ts:4260`; `vp.md:72-130`; `gotchas.md:137, 276, 882` |
| Bindable fields | `d.ts:4497-4541` |
| Variable scopes, aliases, code syntax | `d.ts:9201-9231, 9426`; `vp.md:140-197`; `gotchas.md:857` |
| Styles: create, apply | `d.ts:673-714, 5179, 6226, 6318, 8572`; text/effect style pattern docs; `gotchas.md:297` |
| `ColorStop.boundVariables` | `d.ts:2507-2521` |
| `findAllWithCriteria` incl. `sharedPluginData`; `skipInvisibleInstanceChildren`; shared plugin data | `d.ts:60, 4152-4172, 4704-4761` |
| `getNodeByIdAsync`, `getStyleByIdAsync`, `loadAllPagesAsync` | `d.ts:146-150, 8092-8129` |
| Auto-layout sizing rules (HUG/FILL, `resize` order, text defaults) | `gotchas.md:560-772`; `docs/AUTO-LAYOUT-SPEC.md` |
| Icons via SVG import | `gotchas.md:995-1010`; `d.ts:922` |
| Async batching and traversal cost | `gotchas.md:347-502` |

Not verified from any source in this session: Figma plan limits for library publishing, manifest multi-command syntax, all timing estimates, `createNodeFromSvg` + resize stroke behaviour, behaviour of hidden layers in HUG layouts, and the exact call form for binding gradient stops. These are the content of experiments E3, E4, E6, E10, E12, E19.
