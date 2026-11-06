// Figma Lift DS Verify: runs experiments E1..E20 from docs/COMPONENTS-AND-DESIGN-SYSTEM-SPEC.md section 9 in a scratch file.
// Everything it creates is named FL_VERIFY_* (or lives inside a FL_VERIFY_* page/collection/style) and is removed at the end,
// also when an experiment throws or times out. Output: one JSON object keyed E1..E20 plus CFG and _meta.
// Plain ES2017 on purpose (no ?. or ??), same style as plugin/verify/code.js.
figma.showUI(__html__, { width: 600, height: 720 });

const PFX = 'FL_VERIFY_';
const NS = 'fl_verify_ds';
const TIMEOUT = (typeof globalThis !== 'undefined' && globalThis.__FL_TIMEOUT_MS) || 90000; // per experiment
const INTER = { family: 'Inter', style: 'Regular' };
let VAZ = null; // set in main when Vazirmatn is installed
const FA_SHORT = 'ورود';
const FA_LONG = 'برنامه‌ای متناسب با هدف تو و گزارش هفتگی';

const C = { nodes: [], vars: [], colls: [], styles: [], pages: [] }; // everything we created, for cleanup
const R = {}; // results
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const r2 = (v) => Math.round(v * 100) / 100;
const msg = (e) => (e && e.message ? e.message : String(e));
const plain = (v) => (typeof v === 'symbol' ? 'mixed' : v);
const close = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= (tol === undefined ? 0.6 : tol);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const post = (m) => { try { figma.ui.postMessage(m); } catch (e) { /* UI closed */ } };

// ---- tracked constructors (every node we create is recorded for cleanup) ----
const track = (n) => { C.nodes.push(n); return n; };
const F = (name, w, h) => { const f = track(figma.createFrame()); f.name = PFX + name; if (w) f.resize(w, h || w); f.fills = []; return f; };
const RECT = (name, w, h) => { const r = track(figma.createRectangle()); r.name = PFX + name; r.resize(w, h); return r; };
const COMP = (name) => { const c = track(figma.createComponent()); c.name = PFX + name; return c; };
const TXT = (name, str, font, size) => { const t = track(figma.createText()); t.name = PFX + name; t.fontName = font || INTER; t.fontSize = size || 14; t.characters = str; return t; };
const COLL = (name) => { const c = figma.variables.createVariableCollection(PFX + name); C.colls.push(c); return c; };
const VAR = (name, coll, type) => { const v = figma.variables.createVariable(PFX + name, coll, type); C.vars.push(v); return v; };
const STYLE = (kind, name) => {
  const s = kind === 'text' ? figma.createTextStyle() : kind === 'effect' ? figma.createEffectStyle() : figma.createPaintStyle();
  s.name = PFX + name; C.styles.push(s); return s;
};
const solid = (r, g, b) => ({ type: 'SOLID', color: { r: r, g: g, b: b } });

// ---- snapshots ----
const SNAP_KEYS = ['layoutMode', 'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'primaryAxisSizingMode',
  'counterAxisSizingMode', 'layoutSizingHorizontal', 'layoutSizingVertical', 'layoutPositioning', 'strokesIncludedInLayout',
  'textAutoResize', 'clipsContent', 'width', 'height', 'x', 'y'];
function snap(n) {
  const o = { type: n.type };
  for (const k of SNAP_KEYS) {
    try { const v = n[k]; if (v !== undefined) o[k] = typeof v === 'number' ? r2(v) : plain(v); } catch (e) { /* not defined on this type */ }
  }
  try { if (n.constraints) o.constraints = n.constraints.horizontal + '/' + n.constraints.vertical; } catch (e) { /* none */ }
  return o;
}
function snapTree(n) {
  let out = [snap(n)];
  const kids = n.children || [];
  for (const k of kids) out = out.concat(snapTree(k));
  return out;
}
function diffSnaps(a, b) {
  const d = [];
  if (a.length !== b.length) d.push('node count ' + a.length + ' -> ' + b.length);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    for (const k of Object.keys(a[i])) {
      const x = a[i][k], y = b[i][k];
      if (x !== y && !(typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) < 0.01)) d.push('#' + i + ' ' + a[i].type + '.' + k + ': ' + x + ' -> ' + y);
    }
  }
  return d;
}
function spin(cap, budget, fn) { // bounded sync loop
  const t0 = now(); let n = 0;
  while (n < cap && now() - t0 < budget) { fn(n); n++; }
  return { count: n, ms: r2(now() - t0) };
}
async function spinAsync(cap, budget, pool, fn) { // bounded async loop in pools
  const t0 = now(); let n = 0;
  while (n < cap && now() - t0 < budget) {
    const batch = [];
    for (let i = 0; i < pool && n < cap; i++, n++) batch.push(fn(n));
    await Promise.all(batch);
  }
  return { count: n, ms: r2(now() - t0) };
}
const perMs = (o) => (o.count ? r2(o.ms / o.count) : null);

// A small master button: frame HUG, padding, one TEXT property "Label".
function makeButton(name, font, label) {
  const c = COMP(name);
  c.layoutMode = 'HORIZONTAL'; c.primaryAxisSizingMode = 'AUTO'; c.counterAxisSizingMode = 'AUTO';
  c.paddingLeft = 12; c.paddingRight = 12; c.paddingTop = 8; c.paddingBottom = 8; c.itemSpacing = 8;
  c.fills = [solid(0.5, 0.3, 0.9)];
  const t = TXT('btn-text', label || 'Button', font || INTER, 14);
  c.appendChild(t);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  const key = c.addComponentProperty('Label', 'TEXT', label || 'Button');
  t.componentPropertyReferences = { characters: key };
  return { comp: c, text: t, key: key };
}
function firstText(n) {
  if (n.type === 'TEXT') return n;
  for (const k of (n.children || [])) { const t = firstText(k); if (t) return t; }
  return null;
}

// ---- experiment runner ----
// flagNames: the CFG flags this experiment decides. A failed/timed-out/skipped experiment sets them to null (= unknown).
const FLAGS = {};
const CFG = {};
function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout after ' + ms + 'ms')), ms); })])
    .then((v) => { clearTimeout(t); return v; }, (e) => { clearTimeout(t); throw e; });
}
async function exp(id, title, flagNames, fn) {
  FLAGS[id] = flagNames;
  post({ type: 'progress', id: id, title: title, state: 'running' });
  const t0 = now();
  let entry;
  try {
    const out = await withTimeout(Promise.resolve().then(fn), TIMEOUT);
    entry = { status: out && out.status ? out.status : 'ok', ms: r2(now() - t0), observed: out.observed, decision: out.decision };
    const fl = out.flags || {};
    for (const k of flagNames) CFG[k] = fl[k] === undefined ? null : fl[k];
  } catch (e) {
    const timedOut = /^timeout after/.test(msg(e));
    entry = { status: timedOut ? 'timeout' : 'error', ms: r2(now() - t0), error: msg(e), observed: null, decision: 'UNKNOWN: experiment ' + (timedOut ? 'timed out' : 'threw') + '. Related CFG flags stay null.' };
    for (const k of flagNames) CFG[k] = null;
    if (timedOut) exp.timedOut = true;
  }
  R[id] = entry;
  post({ type: 'progress', id: id, title: title, state: entry.status, ms: entry.ms, decision: entry.decision, error: entry.error });
  await sleep(0); // let the UI paint
}

// =====================================================================================================
// E1: createComponentFromNode keeps layout?
async function E1() {
  // fixture 1: card with fill text, abs child, stroke in layout
  const card = F('e1-card');
  card.layoutMode = 'HORIZONTAL'; card.resize(300, 56);
  card.primaryAxisSizingMode = 'FIXED'; card.counterAxisSizingMode = 'AUTO';
  card.paddingLeft = 12; card.paddingRight = 12; card.paddingTop = 8; card.paddingBottom = 8; card.itemSpacing = 8;
  card.strokes = [solid(0, 0, 0)]; card.strokeWeight = 2; card.strokeAlign = 'INSIDE'; card.strokesIncludedInLayout = true;
  const icon = RECT('e1-icon', 24, 24); card.appendChild(icon);
  const txt = TXT('e1-text', 'A reasonably long label that must wrap inside the card body', INTER, 14); card.appendChild(txt);
  txt.textAutoResize = 'HEIGHT'; txt.layoutSizingHorizontal = 'FILL';
  const badge = F('e1-badge'); badge.layoutMode = 'HORIZONTAL'; badge.paddingLeft = 6; badge.paddingRight = 6;
  const bt = TXT('e1-badge-text', '3', INTER, 11); badge.appendChild(bt); card.appendChild(badge);
  const abs = RECT('e1-abs', 10, 10); card.appendChild(abs);
  abs.layoutPositioning = 'ABSOLUTE'; abs.x = 280; abs.y = 4; abs.constraints = { horizontal: 'MAX', vertical: 'MIN' };
  // fixture 2: hug button
  const btn = F('e1-btn'); btn.layoutMode = 'HORIZONTAL'; btn.primaryAxisSizingMode = 'AUTO'; btn.counterAxisSizingMode = 'AUTO';
  btn.paddingLeft = 12; btn.paddingRight = 12; btn.paddingTop = 8; btn.paddingBottom = 8;
  btn.appendChild(TXT('e1-btn-text', 'Button', INTER, 14));
  const out = {};
  for (const pair of [['card', card], ['button', btn]]) {
    const before = snapTree(pair[1]);
    const comp = track(figma.createComponentFromNode(pair[1]));
    const after = snapTree(comp);
    const diffs = diffSnaps(before, after);
    out[pair[0]] = { nodes: before.length, sameNodeId: comp.id === pair[1].id, typeAfter: comp.type, diffs: diffs };
  }
  const same = out.card.diffs.length === 0 && out.button.diffs.length === 0;
  return {
    observed: out,
    decision: same ? 'Promote-after-build keeps layoutMode, sizing, FILL text, ABSOLUTE child, constraints and stroke-in-layout: buildMaster may use build() then createComponentFromNode.'
      : 'Promotion changed properties (see diffs): re-apply the listed properties after createComponentFromNode, or build masters with figma.createComponent() directly.',
    flags: { promoteKeepsLayout: same },
  };
}

// E2: instance sizing
async function E2() {
  const b = makeButton('e2-btn', INTER, 'Button');
  const o = { master: { w: r2(b.comp.width), h: r2(b.comp.height) } };
  const i1 = track(b.comp.createInstance());
  o.defaultInstance = { w: r2(i1.width), h: r2(i1.height) };
  const i2 = track(b.comp.createInstance());
  i2.resize(200, 44);
  o.resized = { w: r2(i2.width), h: r2(i2.height), primary: i2.primaryAxisSizingMode, counter: i2.counterAxisSizingMode };
  const host = F('e2-host'); host.layoutMode = 'VERTICAL'; host.resize(300, 200); host.primaryAxisSizingMode = 'AUTO'; host.counterAxisSizingMode = 'FIXED';
  const i3 = track(b.comp.createInstance());
  host.appendChild(i3);
  let fillErr = null;
  try { i3.layoutSizingHorizontal = 'FILL'; } catch (e) { fillErr = msg(e); }
  o.fillInAutoLayout = { w: r2(i3.width), sizingH: i3.layoutSizingHorizontal, error: fillErr, hostW: r2(host.width) };
  const i4 = track(b.comp.createInstance());
  i4.setProperties({ [b.key]: 'A much longer label for this button' });
  o.longTextHug = { w: r2(i4.width), grewBy: r2(i4.width - i1.width) };
  const i5 = track(b.comp.createInstance());
  i5.setProperties({ [b.key]: FA_LONG });
  o.rtlStringHug = { w: r2(i5.width), grewBy: r2(i5.width - i1.width), note: 'Inter master, Persian glyphs may use a fallback font' };
  const resizeWorks = close(o.resized.w, 200, 1) && close(o.resized.h, 44, 1);
  const fillWorks = !fillErr && close(o.fillInAutoLayout.w, 300, 1);
  const grows = o.longTextHug.grewBy > 20;
  return {
    observed: o,
    decision: (resizeWorks && fillWorks ? 'Instances behave like frames: resize() and layoutSizingHorizontal=FILL work (spec 2.3 sizeInstance as written).' : 'Instance sizing deviates (see observed): do not rely on sizeInstance, build a plain frame (rung R3) when the checks fail.')
      + (grows ? ' HUG instances grow with longer TEXT property values.' : ' HUG instances did NOT grow with longer text.'),
    flags: { useInstanceSizing: resizeWorks && fillWorks, instanceHugGrowsWithText: grows },
  };
}

// E3: throughput (bounded; count used is recorded)
async function E3() {
  const CAP = 1000, BUDGET = 4000;
  const populate = (root) => {
    const icon = F('e3-icon', 16, 16); const ir = RECT('e3-ir', 8, 8); icon.appendChild(ir); root.appendChild(icon);
    root.appendChild(TXT('e3-text', 'Button', INTER, 14));
    const badge = F('e3-badge', 12, 12); badge.appendChild(TXT('e3-bt', '1', INTER, 9)); root.appendChild(badge);
    root.appendChild(RECT('e3-div', 1, 16)); root.appendChild(RECT('e3-dot', 4, 4));
  };
  const base = (n) => { n.layoutMode = 'HORIZONTAL'; n.primaryAxisSizingMode = 'AUTO'; n.counterAxisSizingMode = 'AUTO'; n.itemSpacing = 4; };
  const master = COMP('e3-master'); base(master); populate(master); // 1 + 2 + 1 + 2 + 1 + 1 = 8 nodes
  const key = master.addComponentProperty('Label', 'TEXT', 'Button');
  master.children[1].componentPropertyReferences = { characters: key };
  const manual = (parent) => { const f = F('e3-m'); base(f); populate(f); parent.appendChild(f); };
  const kinds = {};
  const run = (label, parentKind, fn) => {
    const parent = parentKind === 'section' ? track(figma.createSection()) : F('e3-holder', 100, 100);
    parent.name = PFX + 'e3-' + label;
    const res = spin(CAP, BUDGET, () => fn(parent));
    try { parent.remove(); } catch (e) { /* ignore */ }
    kinds[label] = { count: res.count, ms: res.ms, msPer: perMs(res) };
  };
  run('manual-frame', 'frame', manual);
  run('instance-frame', 'frame', (p) => p.appendChild(master.createInstance()));
  run('instance+setProperties-frame', 'frame', (p) => { const i = master.createInstance(); p.appendChild(i); i.setProperties({ [key]: 'Go' }); });
  run('manual-section', 'section', manual);
  run('instance-section', 'section', (p) => p.appendChild(master.createInstance()));
  const m = kinds['manual-frame'], i = kinds['instance-frame'], is = kinds['instance+setProperties-frame'];
  const faster = m.msPer !== null && i.msPer !== null && i.msPer < m.msPer;
  const instPerSec = i.msPer ? Math.round(1000 / i.msPer) : null;
  const batch = instPerSec ? Math.max(20, Math.min(500, Math.floor(instPerSec / 4))) : null; // about a 250 ms slice per UI yield
  return {
    observed: { cap: CAP, budgetMsPerCase: BUDGET, cases: kinds, instancesPerSec: instPerSec, manualPerSec: m.msPer ? Math.round(1000 / m.msPer) : null,
      speedup: (m.msPer && i.msPer) ? r2(m.msPer / i.msPer) : null, setPropertiesPenaltyMsPer: (is.msPer !== null && i.msPer !== null) ? r2(is.msPer - i.msPer) : null },
    decision: (faster ? 'createInstance() is faster than building 8 nodes by hand: go.' : 'createInstance() was NOT faster than manual building: instances give no speed benefit.') + (batch ? ' Suggested UI-yield batch size ' + batch + ' instances.' : ''),
    flags: { instancesFasterThanManual: faster, instanceBatchSize: batch },
  };
}

// E4: icons, nested vector overrides
async function E4() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  const node = track(figma.createNodeFromSvg(svg)); node.name = PFX + 'e4-icon';
  const comp = track(figma.createComponentFromNode(node));
  const vecOf = (n) => (n.findAll ? n.findAll((x) => x.type === 'VECTOR') : [])[0];
  const mv = vecOf(comp);
  const o = { masterSize: r2(comp.width), masterStrokeWeight: mv ? plain(mv.strokeWeight) : null };
  const inst = track(comp.createInstance());
  const iv = vecOf(inst);
  o.instanceStrokeAt24 = iv ? plain(iv.strokeWeight) : null;
  inst.resize(14, 14);
  const iv2 = vecOf(inst);
  o.instanceStrokeAt14 = iv2 ? plain(iv2.strokeWeight) : null;
  o.instanceSizeAfterResize = r2(inst.width);
  const expected = 2 * 14 / 24;
  const scales = typeof o.instanceStrokeAt14 === 'number' && close(o.instanceStrokeAt14, expected, 0.05);
  try { iv2.strokeWeight = 1.17; o.strokeWeightOverride = plain(iv2.strokeWeight); } catch (e) { o.strokeWeightOverride = 'throws: ' + msg(e); }
  const coll = COLL('e4'); const col = VAR('e4-icon-color', coll, 'COLOR');
  col.setValueForMode(coll.modes[0].modeId, { r: 0.5, g: 0.3, b: 0.9, a: 1 });
  try {
    iv2.strokes = [figma.variables.setBoundVariableForPaint(solid(0, 0, 0), 'color', col)];
    const bv = iv2.strokes[0].boundVariables && iv2.strokes[0].boundVariables.color;
    o.nestedPaintBound = !!bv && bv.id === col.id;
    o.masterStrokeUntouched = mv ? !(mv.strokes[0] && mv.strokes[0].boundVariables && mv.strokes[0].boundVariables.color) : null;
  } catch (e) { o.nestedPaintBound = false; o.nestedPaintError = msg(e); }
  const wOk = typeof o.strokeWeightOverride === 'number';
  return {
    observed: Object.assign(o, { expectedProportionalStroke: r2(expected) }),
    decision: (scales ? 'Resizing an icon instance scales stroke weight proportionally: single master + resize is enough.' : 'Resizing an instance does NOT scale stroke weight (stays ' + o.instanceStrokeAt14 + '): use per-size variants or a strokeWeight override on nested vectors (spec 3.3).')
      + (o.nestedPaintBound ? ' Nested vector paints accept variable bindings on instances.' : ' Nested paint binding failed.')
      + (wOk ? ' strokeWeight is overridable.' : ' strokeWeight override failed.'),
    flags: { iconStrokeScaleOnResize: scales, nestedPaintOverrideBinds: !!o.nestedPaintBound, nestedStrokeWeightOverridable: wOk },
  };
}

// E5: properties before combineAsVariants, 2x2 set with a hole
async function E5() {
  const make = (type, state) => {
    const c = figma.createComponent(); track(c); c.name = 'Type=' + type + ', State=' + state; c.resize(80, 32);
    c.layoutMode = 'HORIZONTAL';
    const t = TXT('e5-t', 'Btn', INTER, 14); c.appendChild(t);
    const key = c.addComponentProperty('Label', 'TEXT', 'Btn');
    t.componentPropertyReferences = { characters: key };
    return { c: c, key: key };
  };
  const m1 = make('A', 'Default'), m2 = make('A', 'Hover'), m3 = make('B', 'Default'); // Type=B,State=Hover is the hole
  const set = track(figma.combineAsVariants([m1.c, m2.c, m3.c], figma.currentPage)); set.name = PFX + 'e5-set';
  const defs = set.componentPropertyDefinitions;
  const names = Object.keys(defs);
  const labelKeys = names.filter((n) => n.indexOf('Label') === 0);
  const o = { memberKeys: [m1.key, m2.key, m3.key], keysEqual: m1.key === m2.key && m2.key === m3.key, setDefinitionNames: names, labelDefinitionCount: labelKeys.length,
    typeOptions: defs.Type ? defs.Type.variantOptions : null, stateOptions: defs.State ? defs.State.variantOptions : null, children: set.children.length };
  const inst = track(set.defaultVariant.createInstance());
  let textSet = false;
  if (labelKeys.length) {
    try { inst.setProperties({ [labelKeys[0]]: 'Changed' }); const t = firstText(inst); textSet = !!t && t.characters === 'Changed'; } catch (e) { o.setLabelError = msg(e); }
  }
  o.instanceTextSetViaSetProperties = textSet;
  try { inst.setProperties({ Type: 'B', State: 'Hover' }); o.holeSelection = 'accepted, instance now ' + (inst.name || '?'); } catch (e) { o.holeSelection = 'throws: ' + msg(e); }
  try { const k = set.addComponentProperty('Extra', 'BOOLEAN', true); o.addPropertyAfterCombine = 'ok ' + k; } catch (e) { o.addPropertyAfterCombine = 'throws: ' + msg(e); }
  const before = labelKeys.length >= 1 && textSet;
  return {
    observed: o,
    decision: (before ? 'TEXT properties added to members BEFORE combineAsVariants survive on the set (' + labelKeys.length + ' Label definition(s), setProperties works): keep the order in spec 2.4.' : 'Properties added before combine did NOT survive/work on the set: add them to the set after combine.')
      + ' Hole in the matrix: ' + o.holeSelection + '.',
    flags: { componentPropertiesBeforeCombine: before, variantHoleSupported: set.children.length === 3 },
  };
}

// E6: hidden child in HUG auto-layout
async function E6() {
  const build = (parent) => {
    parent.layoutMode = 'HORIZONTAL'; parent.primaryAxisSizingMode = 'AUTO'; parent.counterAxisSizingMode = 'AUTO'; parent.itemSpacing = 10;
    const a = RECT('e6-a', 20, 20), b = RECT('e6-b', 20, 20), c = RECT('e6-c', 20, 20);
    parent.appendChild(a); parent.appendChild(b); parent.appendChild(c);
    return b;
  };
  const f = F('e6-plain'); const mid = build(f);
  const full = r2(f.width);
  mid.visible = false;
  const hidden = r2(f.width);
  const comp = COMP('e6-comp'); const cmid = build(comp);
  const key = comp.addComponentProperty('Show mid', 'BOOLEAN', true);
  cmid.componentPropertyReferences = { visible: key };
  const inst = track(comp.createInstance());
  const w0 = r2(inst.width);
  let w1 = null, err = null;
  try { inst.setProperties({ [key]: false }); w1 = r2(inst.width); } catch (e) { err = msg(e); }
  const collapses = close(hidden, 50, 0.6);
  return {
    observed: { fullWidth: full, hiddenWidth: hidden, expectIfCollapsed: 50, expectIfGapKept: 70, instanceDefault: w0, instanceBooleanFalse: w1, booleanError: err },
    decision: collapses ? 'A hidden child is removed from the auto-layout flow including its gap: optional parts (BOOLEAN) render like the source without a missing icon.'
      : 'A hidden child still reserves its gap (width ' + hidden + '): for optional parts also shrink the parent padding/gap or remove the node instead of hiding it.',
    flags: { hiddenChildGapCollapses: collapses, booleanPropHidesChild: w1 !== null && close(w1, 50, 0.6) },
  };
}

// E7: nested instances, exposure, INSTANCE_SWAP
async function E7() {
  const btn = makeButton('e7-btn', INTER, 'Btn');
  const iconA = COMP('e7-iconA'); iconA.resize(16, 16); iconA.fills = [solid(1, 0, 0)];
  const iconB = COMP('e7-iconB'); iconB.resize(16, 16); iconB.fills = [solid(0, 0, 1)];
  const card = COMP('e7-card');
  card.layoutMode = 'HORIZONTAL'; card.primaryAxisSizingMode = 'AUTO'; card.counterAxisSizingMode = 'AUTO'; card.itemSpacing = 8;
  const nested = track(btn.comp.createInstance()); card.appendChild(nested);
  const slot = track(iconA.createInstance()); card.appendChild(slot);
  const o = {};
  let exposeSet = false;
  try { nested.isExposedInstance = true; exposeSet = nested.isExposedInstance === true; } catch (e) { o.exposeError = msg(e); }
  const swapKey = card.addComponentProperty('Icon', 'INSTANCE_SWAP', iconA.id);
  slot.componentPropertyReferences = { mainComponent: swapKey };
  const cardInst = track(card.createInstance());
  o.exposedInstancesOnParentInstance = cardInst.exposedInstances.length;
  o.parentInstancePropertyNames = Object.keys(cardInst.componentProperties);
  o.nestedPropsVisibleOnParent = o.parentInstancePropertyNames.filter((k) => k.indexOf('Label') === 0).length;
  const insts = cardInst.findAll((x) => x.type === 'INSTANCE');
  let viaParent = false;
  for (const n of insts) {
    const mc = await n.getMainComponentAsync();
    if (mc && mc.id === btn.comp.id) {
      try { n.setProperties({ [btn.key]: 'FromParent' }); const t = firstText(n); viaParent = !!t && t.characters === 'FromParent'; } catch (e) { o.nestedSetError = msg(e); }
    }
  }
  let swapOk = false;
  try {
    cardInst.setProperties({ [swapKey]: iconB.id });
    for (const n of cardInst.findAll((x) => x.type === 'INSTANCE')) {
      const mc = await n.getMainComponentAsync();
      if (mc && mc.id === iconB.id) swapOk = true;
    }
  } catch (e) { o.swapError = msg(e); }
  o.exposeSettable = exposeSet; o.nestedPropsViaParent = viaParent; o.swapViaSetProperties = swapOk;
  return {
    observed: o,
    decision: (exposeSet ? 'isExposedInstance can be set on a nested instance (exposed on parent instance: ' + o.exposedInstancesOnParentInstance + ').' : 'isExposedInstance could not be set.')
      + (viaParent ? ' Nested instance props can be set by walking into the parent instance.' : ' Nested props via parent failed.')
      + (swapOk ? ' INSTANCE_SWAP via setProperties(componentId) works.' : ' INSTANCE_SWAP via setProperties failed.'),
    flags: { exposeNested: exposeSet && o.exposedInstancesOnParentInstance >= 1, nestedPropsViaParent: viaParent, swapViaSetProperties: swapOk },
  };
}

// E8: binding costs (bounded)
async function E8() {
  const CAP = 10000, BUDGET = 3000;
  const coll = COLL('e8');
  const cv = VAR('e8-color', coll, 'COLOR'); cv.setValueForMode(coll.modes[0].modeId, { r: 0.2, g: 0.4, b: 0.8, a: 1 });
  const fv = VAR('e8-float', coll, 'FLOAT'); fv.setValueForMode(coll.modes[0].modeId, 8);
  const rects = []; for (let i = 0; i < 300; i++) rects.push(RECT('e8-r', 10, 10));
  const frames = []; for (let i = 0; i < 100; i++) { const f = F('e8-f', 20, 20); f.layoutMode = 'HORIZONTAL'; frames.push(f); }
  const base = solid(0.9, 0.1, 0.1);
  const paint = spin(CAP, BUDGET, (i) => { rects[i % rects.length].fills = [figma.variables.setBoundVariableForPaint(base, 'color', cv)]; });
  let field = { count: 0, ms: 0 }, fieldErr = null;
  try { field = spin(CAP, BUDGET, (i) => { frames[i % frames.length].setBoundVariable('itemSpacing', fv); }); } catch (e) { fieldErr = msg(e); }
  const st = STYLE('text', 'e8-style'); st.fontName = INTER; st.fontSize = 14;
  const texts = []; for (let i = 0; i < 300; i++) texts.push(TXT('e8-t', 'x', INTER, 14));
  let style = { count: 0, ms: 0 }, styleErr = null;
  try { style = await spinAsync(1000, BUDGET, 100, (i) => texts[i % texts.length].setTextStyleIdAsync(st.id)); } catch (e) { styleErr = msg(e); }
  const pp = perMs(paint), fp = perMs(field), sp = perMs(style);
  const NODES = 91383, TEXTS = 30000; // sizes of the real corpus (spec 0.1), texts is a rough share
  const estSec = (pp !== null && fp !== null && sp !== null) ? r2((NODES * (pp + fp) + TEXTS * sp) / 1000) : null;
  const all = estSec !== null && estSec <= 120;
  return {
    observed: { cap: CAP, budgetMsPerLoop: BUDGET, paintBind: { count: paint.count, ms: paint.ms, msPerCall: pp }, fieldBind: { count: field.count, ms: field.ms, msPerCall: fp, error: fieldErr },
      textStyleIdAsyncPool100: { count: style.count, ms: style.ms, msPerCall: sp, error: styleErr }, estimatedSecondsForFullCorpus: estSec, estimateModel: '91383 nodes x (paint + field) + 30000 texts x style; threshold 120 s' },
    decision: estSec === null ? 'UNKNOWN: a loop failed, cannot extrapolate. Default to bindScope "components".'
      : (all ? 'Estimated ' + estSec + ' s to bind the whole corpus: bindScope "all" is affordable.' : 'Estimated ' + estSec + ' s to bind the whole corpus: default to bindScope "components".'),
    flags: { bindScope: estSec === null ? 'components' : (all ? 'all' : 'components'), bindMsPerCall: pp },
  };
}

// E9: registry across pages
async function E9() {
  const o = {};
  const work = figma.currentPage;
  const others = figma.root.children.filter((p) => p !== work && C.pages.indexOf(p) < 0);
  o.otherOriginalPages = others.length;
  if (others.length) {
    try { o.preLoadChildrenOfOtherPage = 'readable (' + others[0].children.length + ' children)'; } catch (e) { o.preLoadChildrenOfOtherPage = 'throws: ' + msg(e); }
  } else o.preLoadChildrenOfOtherPage = 'n/a (the file has only one original page: put a second page with content in the scratch file to test this)';
  const page2 = figma.createPage(); page2.name = PFX + 'page2'; C.pages.push(page2);
  const here = COMP('e9-here'); here.setSharedPluginData(NS, 'cmp', 'x0');
  const there = COMP('e9-there'); there.setSharedPluginData(NS, 'cmp', 'x1');
  page2.appendChild(there);
  const crit = { types: ['COMPONENT', 'COMPONENT_SET'], sharedPluginData: { namespace: NS, keys: ['cmp'] } };
  const skip = figma.skipInvisibleInstanceChildren;
  figma.skipInvisibleInstanceChildren = true;
  try {
    o.currentPageCount = work.findAllWithCriteria(crit).length;
    o.page2Count = page2.findAllWithCriteria(crit).length;
    await figma.loadAllPagesAsync();
    const t0 = now(); let total = 0;
    for (const p of figma.root.children) total += p.findAllWithCriteria(crit).length;
    o.allPagesLoopCount = total; o.allPagesLoopMs = r2(now() - t0);
    o.rootHasFindAllWithCriteria = typeof figma.root.findAllWithCriteria === 'function';
    o.byIdFromOtherPage = !!(await figma.getNodeByIdAsync(there.id));
    o.sharedDataReadBack = there.getSharedPluginData(NS, 'cmp');
    o.preloadedOtherPageChildrenAfterLoadAll = others.length ? others[0].children.length : null;
  } finally { figma.skipInvisibleInstanceChildren = skip; }
  const cross = o.allPagesLoopCount >= 2 && o.byIdFromOtherPage === true;
  return {
    observed: o,
    decision: cross ? 'After loadAllPagesAsync a loop of page.findAllWithCriteria({sharedPluginData}) over figma.root.children finds registry nodes on every page (' + o.allPagesLoopMs + ' ms), and getNodeByIdAsync resolves cross-page ids: the registry may live on a separate "Lift Components" page.'
      : 'Cross-page registry lookup did not work as expected (see observed): keep masters on the same page as the screens.',
    flags: { registryCrossPage: cross, registryRootFindAll: !!o.rootHasFindAllWithCriteria },
  };
}

// E10: import by key of an unpublished local component
async function E10() {
  const c = COMP('e10-comp'); c.resize(10, 10);
  const a = COMP('e10-a'); a.name = 'Type=A'; const b = COMP('e10-b'); b.name = 'Type=B';
  const set = track(figma.combineAsVariants([a, b], figma.currentPage)); set.name = PFX + 'e10-set';
  const o = { componentKey: c.key || null, setKey: set.key || null };
  try { const imp = await figma.importComponentByKeyAsync(c.key); o.importComponent = 'RESOLVED (id ' + imp.id + ', same node: ' + (imp.id === c.id) + ')'; o.importComponentWorks = true; }
  catch (e) { o.importComponent = 'rejects: ' + msg(e); o.importComponentWorks = false; }
  try { const imp = await figma.importComponentSetByKeyAsync(set.key); o.importSet = 'RESOLVED (id ' + imp.id + ')'; o.importSetWorks = true; }
  catch (e) { o.importSet = 'rejects: ' + msg(e); o.importSetWorks = false; }
  const works = o.importComponentWorks === true;
  return {
    observed: o,
    decision: works ? 'Local (unpublished) keys ARE importable: library publishing is not required for cross-file reuse inside this file.' : 'Local keys are NOT importable: cross-file reuse needs a published library; keep exports and the design system in one file (spec 2.8.4).',
    flags: { localKeyImportWorks: works },
  };
}

// E11: text style vs ranges and bound fill
async function E11() {
  const red = [solid(1, 0, 0)];
  const st = STYLE('text', 'e11-style'); st.fontName = INTER; st.fontSize = 14;
  const coll = COLL('e11'); const cv = VAR('e11-color', coll, 'COLOR'); cv.setValueForMode(coll.modes[0].modeId, { r: 0.1, g: 0.8, b: 0.3, a: 1 });
  const o = {};
  // A: runs first, then style
  const a = TXT('e11-a', 'Hello world', INTER, 14);
  a.setRangeFontSize(0, 5, 24); a.setRangeFills(0, 5, red);
  await a.setTextStyleIdAsync(st.id);
  const fsA = plain(a.getRangeFontSize(0, 5)), fillA = a.getRangeFills(0, 5);
  o.runsThenStyle = { fontSizeOfFirstWord: fsA, firstWordFill: plain(fillA) === 'mixed' ? 'mixed' : JSON.stringify(fillA).slice(0, 120), textStyleId: typeof a.textStyleId === 'symbol' ? 'mixed' : a.textStyleId === st.id ? 'style' : a.textStyleId };
  const keepsSize = fsA === 24;
  const keepsFill = Array.isArray(fillA) && fillA[0] && fillA[0].color && fillA[0].color.r === 1 && fillA[0].color.g === 0;
  // B: bound fill, then style
  const b = TXT('e11-b', 'Hello world', INTER, 14);
  b.fills = [figma.variables.setBoundVariableForPaint(solid(0, 0, 0), 'color', cv)];
  await b.setTextStyleIdAsync(st.id);
  const bv = b.fills[0] && b.fills[0].boundVariables && b.fills[0].boundVariables.color;
  o.boundFillThenStyle = { stillBound: !!bv && bv.id === cv.id };
  // C: style first, then runs
  const c = TXT('e11-c', 'Hello world', INTER, 14);
  await c.setTextStyleIdAsync(st.id);
  c.setRangeFontSize(0, 5, 24); c.setRangeFills(0, 5, red);
  o.styleThenRuns = { fontSizeOfFirstWord: plain(c.getRangeFontSize(0, 5)), restOfText: plain(c.getRangeFontSize(6, 11)) };
  const order = o.styleThenRuns.fontSizeOfFirstWord === 24;
  const keepsRuns = keepsSize && keepsFill;
  return {
    observed: o,
    decision: (keepsRuns ? 'Applying a text style keeps range font size and range fills (any order).' : 'Applying a text style OVERWRITES range overrides: apply the style first, then re-apply runs (spec 4.5 order).')
      + (o.boundFillThenStyle.stillBound ? ' A bound fill variable survives the style.' : ' A bound fill variable is lost when the style is applied: bind fills after the style.')
      + (order ? ' Style then runs works.' : ' Style then runs did not give the expected ranges.'),
    flags: { textStyleKeepsRuns: keepsRuns, textStyleKeepsBoundFill: o.boundFillThenStyle.stillBound, styleBeforeRunsWorks: order },
  };
}

// E12: effect style + bound colour, gradient stop bound variables
async function E12() {
  const coll = COLL('e12'); const cv = VAR('e12-accent', coll, 'COLOR'); cv.setValueForMode(coll.modes[0].modeId, { r: 0.5, g: 0.3, b: 0.9, a: 1 });
  const o = {};
  const eff = { type: 'DROP_SHADOW', color: { r: 0.5, g: 0.3, b: 0.9, a: 0.25 }, offset: { x: 0, y: 0 }, radius: 16, spread: 0, visible: true, blendMode: 'NORMAL' };
  const bound = figma.variables.setBoundVariableForEffect(eff, 'color', cv);
  const es = STYLE('effect', 'e12-glow'); es.effects = [bound];
  const rb = es.effects[0].boundVariables && es.effects[0].boundVariables.color;
  o.effectStyleBoundColor = !!rb && rb.id === cv.id;
  o.effectColorAlphaStored = es.effects[0].color ? r2(es.effects[0].color.a) : null;
  const target = F('e12-target', 40, 40); target.fills = [solid(1, 1, 1)];
  await target.setEffectStyleIdAsync(es.id);
  o.nodeAfterApplyingStyle = { effectStyleIdSet: target.effectStyleId === es.id, effects: target.effects.length, boundColor: !!(target.effects[0] && target.effects[0].boundVariables && target.effects[0].boundVariables.color) };
  // gradient stops
  const alias = figma.variables.createVariableAlias(cv);
  const grad = { type: 'GRADIENT_LINEAR', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [
    { position: 0, color: { r: 0.5, g: 0.3, b: 0.9, a: 1 }, boundVariables: { color: alias } },
    { position: 1, color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }] };
  const r = RECT('e12-grad', 40, 40);
  const stopBound = (paint) => { const s = paint && paint.gradientStops && paint.gradientStops[0]; return !!(s && s.boundVariables && s.boundVariables.color); };
  try { r.fills = [grad]; o.formA_stopLiteralBoundVariables = stopBound(r.fills[0]); } catch (e) { o.formA_stopLiteralBoundVariables = 'throws: ' + msg(e); }
  try { const p = figma.variables.setBoundVariableForPaint(grad, 'color', cv); r.fills = [p]; o.formB_setBoundVariableForPaintOnGradient = stopBound(r.fills[0]); } catch (e) { o.formB_setBoundVariableForPaintOnGradient = 'throws: ' + msg(e); }
  try { const ps = STYLE('paint', 'e12-gradstyle'); ps.paints = [grad]; o.formC_paintStyleWithStopBinding = stopBound(ps.paints[0]); } catch (e) { o.formC_paintStyleWithStopBinding = 'throws: ' + msg(e); }
  const form = o.formA_stopLiteralBoundVariables === true ? 'stops[i].boundVariables.color = figma.variables.createVariableAlias(v) inside the paint literal'
    : o.formB_setBoundVariableForPaintOnGradient === true ? 'figma.variables.setBoundVariableForPaint(gradientPaint, "color", v)' : 'none';
  return {
    observed: o,
    decision: (o.effectStyleBoundColor ? 'Effect styles keep a bound colour variable (setBoundVariableForEffect before assigning effects).' : 'Effect style did not keep the bound colour variable: use literal colours in effect styles.')
      + ' Gradient stop binding form: ' + form + '.',
    flags: { effectStyleBindsVariable: o.effectStyleBoundColor, gradientStopBindForm: form === 'none' ? null : form },
  };
}

// E13: text style letterSpacing / lineHeight fidelity
async function E13() {
  const st = STYLE('text', 'e13-style'); st.fontName = INTER; st.fontSize = 11;
  const o = {};
  st.letterSpacing = { unit: 'PERCENT', value: 2.5 }; o.letterSpacingPercentWritten = 2.5; o.letterSpacingPercentRead = { unit: st.letterSpacing.unit, value: st.letterSpacing.value };
  st.letterSpacing = { unit: 'PIXELS', value: 0.275 }; o.letterSpacingPixelsWritten = 0.275; o.letterSpacingPixelsRead = { unit: st.letterSpacing.unit, value: st.letterSpacing.value };
  o.lineHeights = {};
  let exact = true;
  for (const v of [16.5, 13.75, 19.5]) {
    st.lineHeight = { unit: 'PIXELS', value: v };
    const rd = st.lineHeight; o.lineHeights[v] = { unit: rd.unit, value: rd.value };
    if (!(rd.unit === 'PIXELS' && close(rd.value, v, 0.001))) exact = false;
  }
  st.letterSpacing = { unit: 'PERCENT', value: 2.5 };
  const t = TXT('e13-text', 'sample', INTER, 11);
  await t.setTextStyleIdAsync(st.id);
  o.textNodeAfterStyle = { lineHeight: t.lineHeight && { unit: t.lineHeight.unit, value: t.lineHeight.value }, letterSpacing: t.letterSpacing && { unit: t.letterSpacing.unit, value: t.letterSpacing.value } };
  const pctExact = o.letterSpacingPercentRead.unit === 'PERCENT' && close(o.letterSpacingPercentRead.value, 2.5, 0.001);
  const pxExact = o.letterSpacingPixelsRead.unit === 'PIXELS' && close(o.letterSpacingPixelsRead.value, 0.275, 0.001);
  const unit = pctExact ? 'PERCENT' : pxExact ? 'PIXELS' : 'PERCENT';
  return {
    observed: o,
    decision: 'lineHeight in PIXELS with fractional values is ' + (exact ? 'stored exactly' : 'NOT stored exactly (see lineHeights)') + '. letterSpacing 0.025em: PERCENT 2.5 is ' + (pctExact ? 'exact' : 'rounded') + ', PIXELS 0.275 is ' + (pxExact ? 'exact' : 'rounded') + ' -> write letterSpacing as ' + unit + '.',
    flags: { lineHeightFractionalExact: exact, letterSpacingUnit: unit },
  };
}

// E14: variables, scopes, aliases, code syntax
async function E14() {
  const o = {};
  const prim = COLL('e14-primitives');
  const pv = VAR('e14-violet-500', prim, 'COLOR'); pv.setValueForMode(prim.modes[0].modeId, { r: 0.5, g: 0.3, b: 0.9, a: 1 });
  pv.scopes = []; pv.hiddenFromPublishing = true;
  const sem = COLL('e14-color');
  const darkId = sem.modes[0].modeId;
  try { sem.renameMode(darkId, 'Dark'); } catch (e) { o.renameModeError = msg(e); }
  let lightId = null;
  try { lightId = sem.addMode('Light'); o.secondModeCreated = true; } catch (e) { o.secondModeCreated = false; o.secondModeError = msg(e); }
  const sv = VAR('e14-bg-accent', sem, 'COLOR');
  sv.scopes = ['FRAME_FILL', 'SHAPE_FILL'];
  sv.setVariableCodeSyntax('WEB', 'colors.accent');
  sv.setValueForMode(darkId, figma.variables.createVariableAlias(pv));
  if (lightId) sv.setValueForMode(lightId, { r: 1, g: 1, b: 1, a: 1 });
  const again = await figma.variables.getVariableByIdAsync(sv.id);
  const pAgain = await figma.variables.getVariableByIdAsync(pv.id);
  o.semanticScopes = again.scopes; o.primitiveScopes = pAgain.scopes; o.primitiveHiddenFromPublishing = pAgain.hiddenFromPublishing;
  o.codeSyntax = again.codeSyntax;
  const val = again.valuesByMode[darkId];
  o.darkValue = val && val.type ? { type: val.type, aliasesPrimitive: val.id === pv.id } : val;
  const rect = RECT('e14-rect', 10, 10);
  rect.fills = [figma.variables.setBoundVariableForPaint(solid(0, 0, 0), 'color', sv)];
  try { const res = sv.resolveForConsumer(rect); o.resolved = { resolvedType: res.resolvedType, value: res.value && { r: r2(res.value.r), g: r2(res.value.g), b: r2(res.value.b) } }; } catch (e) { o.resolveError = msg(e); }
  const scopesOk = Array.isArray(again.scopes) && again.scopes.length === 2 && again.scopes.indexOf('FRAME_FILL') >= 0 && Array.isArray(pAgain.scopes) && pAgain.scopes.length === 0;
  const aliasOk = !!(val && val.type === 'VARIABLE_ALIAS' && val.id === pv.id);
  const csOk = !!(again.codeSyntax && again.codeSyntax.WEB === 'colors.accent');
  return {
    observed: o,
    decision: 'Scopes persisted: ' + scopesOk + '; alias chain Primitives -> Color: ' + aliasOk + '; WEB code syntax: ' + csOk + '; second mode ' + (o.secondModeCreated ? 'available' : 'NOT available (plan limit?)') + '.',
    flags: { variableScopesPersist: scopesOk, aliasChainWorks: aliasOk, codeSyntaxWorks: csOk, multiModeAvailable: !!o.secondModeCreated },
  };
}

// E15: instance-level root properties
async function E15() {
  const c = COMP('e15-comp'); c.resize(60, 40); c.clipsContent = true; c.opacity = 0.6; c.blendMode = 'MULTIPLY';
  c.fills = [solid(1, 0, 0), { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 0.5 }];
  c.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 2 }, radius: 4, visible: true, blendMode: 'NORMAL' }];
  const r1 = RECT('first', 20, 20), r2n = RECT('second', 20, 20); r1.name = 'first'; r2n.name = 'second'; c.appendChild(r1); c.appendChild(r2n);
  const i = track(c.createInstance());
  const same = {
    clipsContent: i.clipsContent === c.clipsContent, opacity: close(i.opacity, c.opacity, 0.001), blendMode: i.blendMode === c.blendMode,
    fills: JSON.stringify(i.fills) === JSON.stringify(c.fills), effects: i.effects.length === c.effects.length,
    childOrder: i.children.map((n) => n.name).join(',') === c.children.map((n) => n.name).join(','),
  };
  const ov = {};
  const tryset = (k, fn) => { try { fn(); ov[k] = true; } catch (e) { ov[k] = 'throws: ' + msg(e); } };
  tryset('opacity', () => { i.opacity = 0.3; if (!close(i.opacity, 0.3, 0.001)) throw new Error('not applied'); });
  tryset('blendMode', () => { i.blendMode = 'NORMAL'; if (i.blendMode !== 'NORMAL') throw new Error('not applied'); });
  tryset('clipsContent', () => { i.clipsContent = false; if (i.clipsContent !== false) throw new Error('not applied'); });
  tryset('rotation', () => { i.rotation = 30; if (!close(i.rotation, 30, 0.5)) throw new Error('not applied'); });
  const masterUntouched = close(c.opacity, 0.6, 0.001) && c.blendMode === 'MULTIPLY' && c.clipsContent === true && close(c.rotation, 0, 0.01);
  const preserved = Object.keys(same).every((k) => same[k]);
  return {
    observed: { instanceMatchesMaster: same, overridesOnInstance: ov, masterUntouchedAfterOverrides: masterUntouched },
    decision: (preserved ? 'Instances inherit clipsContent, opacity, blendMode, fills (order) and effects from the master.' : 'Some root properties are not inherited by instances (see instanceMatchesMaster): such nodes cannot be plain instances.')
      + ' Instance-level overrides: ' + Object.keys(ov).map((k) => k + '=' + (ov[k] === true ? 'ok' : 'FAIL')).join(', ') + '.',
    flags: { instanceRootPropsPreserved: preserved, instanceRotationSettable: ov.rotation === true, instanceRootOverridable: ov.opacity === true && ov.blendMode === true && ov.clipsContent === true },
  };
}

// E16: swapComponent vs mainComponent assignment
async function E16() {
  const mk = (type) => { const c = figma.createComponent(); track(c); c.name = 'Type=' + type; c.resize(60, 24); c.layoutMode = 'HORIZONTAL'; c.appendChild(TXT('e16-t', 'x', INTER, 14)); return c; };
  const a = mk('A'), b = mk('B');
  const set = track(figma.combineAsVariants([a, b], figma.currentPage)); set.name = PFX + 'e16-set';
  const o = {};
  const inst = track(a.createInstance());
  const txt = firstText(inst); txt.characters = 'OVERRIDE';
  try { inst.swapComponent(b); o.swapComponent = { textAfter: firstText(inst).characters, main: (await inst.getMainComponentAsync()).name }; } catch (e) { o.swapComponent = { error: msg(e) }; }
  const keepsSwap = !!o.swapComponent.textAfter && o.swapComponent.textAfter === 'OVERRIDE';
  const inst2 = track(a.createInstance()); firstText(inst2).characters = 'OVERRIDE';
  try { inst2.mainComponent = b; o.mainComponentAssign = { textAfter: firstText(inst2).characters, main: (await inst2.getMainComponentAsync()).name }; } catch (e) { o.mainComponentAssign = { error: msg(e) }; }
  const clearsAssign = !!o.mainComponentAssign.textAfter && o.mainComponentAssign.textAfter !== 'OVERRIDE';
  const inst3 = track(a.createInstance()); firstText(inst3).characters = 'OVERRIDE';
  try { inst3.setProperties({ Type: 'B' }); o.setProperties = { textAfter: firstText(inst3).characters, main: (await inst3.getMainComponentAsync()).name }; } catch (e) { o.setProperties = { error: msg(e) }; }
  const keepsSet = !!o.setProperties.textAfter && o.setProperties.textAfter === 'OVERRIDE';
  const N = 200, BUDGET = 2000;
  const toggle = (fn) => { const i = track(a.createInstance()); return spin(N, BUDGET, (k) => fn(i, k % 2 ? a : b, k % 2 ? 'A' : 'B')); };
  const sw = toggle((i, to) => i.swapComponent(to));
  const as = toggle((i, to) => { i.mainComponent = to; });
  const sp = toggle((i, to, name) => i.setProperties({ Type: name }));
  o.cost = { swapComponent: { count: sw.count, msPer: perMs(sw) }, mainComponentAssign: { count: as.count, msPer: perMs(as) }, setProperties: { count: sp.count, msPer: perMs(sp) } };
  let api = 'createInstance from the right variant child';
  if (keepsSwap && keepsSet) api = (perMs(sw) !== null && perMs(sp) !== null && perMs(sw) <= perMs(sp)) ? 'swapComponent' : 'setProperties';
  else if (keepsSwap) api = 'swapComponent'; else if (keepsSet) api = 'setProperties';
  return {
    observed: o,
    decision: 'swapComponent keeps overrides: ' + keepsSwap + '; mainComponent assignment clears them: ' + clearsAssign + '; setProperties({Type}) keeps overrides: ' + keepsSet + '. Preferred variant-switch API: ' + api + '.',
    flags: { swapKeepsOverrides: keepsSwap, variantSwitchApi: api },
  };
}

// E17: combineAsVariants with 24 members
async function E17() {
  const types = ['A', 'B', 'C', 'D'], states = ['Default', 'Hover', 'Pressed'], sizes = ['S', 'M'];
  const members = [];
  const t0 = now();
  for (const ty of types) for (const st of states) for (const sz of sizes) {
    const c = figma.createComponent(); track(c); c.name = 'Type=' + ty + ', State=' + st + ', Size=' + sz;
    c.resize(sz === 'S' ? 80 : 120, sz === 'S' ? 28 : 40); c.fills = [solid(0.3, 0.3, 0.3)];
    c.layoutMode = 'HORIZONTAL'; c.appendChild(TXT('e17-t', ty + st, INTER, 12));
    members.push({ c: c, ty: ty, st: st, sz: sz });
  }
  const createMs = r2(now() - t0);
  const t1 = now();
  const set = track(figma.combineAsVariants(members.map((m) => m.c), figma.currentPage)); set.name = PFX + 'e17-set';
  const combineMs = r2(now() - t1);
  const posBefore = {}; for (const ch of set.children) posBefore[r2(ch.x) + ',' + r2(ch.y)] = true;
  const distinctBefore = Object.keys(posBefore).length;
  const sizeBefore = { w: r2(set.width), h: r2(set.height) };
  const t2 = now();
  const colW = 140, rowH = 56;
  for (const m of members) {
    const col = states.indexOf(m.st) * sizes.length + sizes.indexOf(m.sz), row = types.indexOf(m.ty);
    m.c.x = col * colW + 20; m.c.y = row * rowH + 20;
  }
  let mx = 0, my = 0;
  for (const ch of set.children) { mx = Math.max(mx, ch.x + ch.width); my = Math.max(my, ch.y + ch.height); }
  set.resizeWithoutConstraints(mx + 20, my + 20);
  const layoutMs = r2(now() - t2);
  const overlap = (() => { const ch = set.children; for (let i = 0; i < ch.length; i++) for (let j = i + 1; j < ch.length; j++) { const p = ch[i], q = ch[j]; if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) return true; } return false; })();
  const needHelper = distinctBefore < members.length;
  return {
    observed: { members: members.length, createMs: createMs, combineMs: combineMs, layoutMs: layoutMs, childrenAfterCombine: set.children.length, distinctPositionsBeforeLayout: distinctBefore, setSizeBeforeLayout: sizeBefore,
      setSizeAfterLayout: { w: r2(set.width), h: r2(set.height) }, overlapAfterLayout: overlap, variantProps: Object.keys(set.componentPropertyDefinitions) },
    decision: (set.children.length === members.length ? '24-member set combined in ' + combineMs + ' ms.' : 'Set has ' + set.children.length + ' children instead of 24!')
      + (needHelper ? ' Members stack on top of each other after combine: the grid layout helper + resizeWithoutConstraints from child bounds is REQUIRED.' : ' combineAsVariants already spreads members; helper optional.')
      + (overlap ? ' Overlap remained after the helper.' : ''),
    flags: { combineLayoutHelperNeeded: needHelper, variantSetOf24Ok: set.children.length === members.length && !overlap },
  };
}

// E18: component in a Section, description, documentation links
async function E18() {
  const section = track(figma.createSection()); section.name = PFX + 'e18-section';
  const c = COMP('e18-comp'); c.resize(40, 40);
  section.appendChild(c);
  const o = { parentType: c.parent ? c.parent.type : null };
  c.description = 'Figma Lift conf 87 (review)';
  o.descriptionReadBack = c.description;
  try { c.documentationLinks = [{ uri: 'https://example.com/figma-lift' }]; o.documentationLinks = c.documentationLinks.map((l) => l.uri); } catch (e) { o.documentationLinks = 'throws: ' + msg(e); }
  const found = [];
  for (const p of figma.root.children) { try { if (p === figma.currentPage) found.push(...p.findAllWithCriteria({ types: ['COMPONENT'] }).filter((n) => n.id === c.id)); } catch (e) { /* page not loaded */ } }
  o.foundByTypeSearchOnPage = found.length === 1;
  o.assetsPanel = 'MANUAL CHECK: the plugin cannot read the Assets panel; components inside Sections are listed there by Figma design. Verify by hand if needed (the nodes are deleted at the end).';
  const ok = o.parentType === 'SECTION' && o.descriptionReadBack === 'Figma Lift conf 87 (review)';
  return {
    observed: o,
    decision: ok ? 'A component can live inside a Section; description persists' + (Array.isArray(o.documentationLinks) ? ' and documentationLinks too (store conf tags there or in the description).' : '; documentationLinks failed.') : 'Component in Section or description failed (see observed).',
    flags: { componentInSectionOk: o.parentType === 'SECTION', descriptionPersists: o.descriptionReadBack === 'Figma Lift conf 87 (review)', documentationLinksWork: Array.isArray(o.documentationLinks) },
  };
}

// E19: figma.command / multi-command manifest
async function E19() {
  const o = { command: figma.command, commandType: typeof figma.command, editorType: figma.editorType };
  const empty = o.command === '' || o.command === undefined || o.command === null;
  return {
    observed: o,
    decision: empty ? 'figma.command is empty in this run (manifest has no "menu"). To test multi-command, import plugin/verify-ds/manifest-menu.json instead and run both menu entries (see docs/VERIFY-DS-IN-FIGMA.md, E19).'
      : 'figma.command = "' + o.command + '": menu commands reach the plugin. Multi-command manifest syntax is confirmed for this client.',
    flags: { menuCommandsAvailable: empty ? null : true, figmaCommandValue: empty ? '' : o.command },
  };
}

// E20: TEXT property with Vazirmatn
async function E20() {
  const font = VAZ || INTER;
  const o = { usedFont: font.family + ' ' + font.style, vazirmatnMissing: !VAZ };
  const b = makeButton('e20-btn', font, FA_SHORT);
  const i0 = track(b.comp.createInstance());
  const i1 = track(b.comp.createInstance());
  i1.setProperties({ [b.key]: FA_LONG });
  const t1 = firstText(i1);
  o.hug = { defaultWidth: r2(i0.width), longWidth: r2(i1.width), textAutoResize: t1.textAutoResize, fontFamily: t1.fontName.family, characters: t1.characters === FA_LONG };
  // wrapping variant: fixed 160px column with FILL text
  const col = COMP('e20-col'); col.layoutMode = 'VERTICAL'; col.resize(160, 40); col.primaryAxisSizingMode = 'AUTO'; col.counterAxisSizingMode = 'FIXED';
  const tx = TXT('e20-t', FA_SHORT, font, 14); col.appendChild(tx); tx.textAutoResize = 'HEIGHT'; tx.layoutSizingHorizontal = 'FILL';
  const key = col.addComponentProperty('Label', 'TEXT', FA_SHORT); tx.componentPropertyReferences = { characters: key };
  const c0 = track(col.createInstance()); const c1 = track(col.createInstance());
  c1.setProperties({ [key]: FA_LONG + ' ' + FA_LONG });
  const ct = firstText(c1);
  o.wrap = { defaultHeight: r2(c0.height), longHeight: r2(c1.height), width: r2(c1.width), textAutoResize: ct.textAutoResize, fillKept: ct.layoutSizingHorizontal };
  const keeps = o.hug.textAutoResize === 'WIDTH_AND_HEIGHT' && o.wrap.textAutoResize === 'HEIGHT' && o.wrap.fillKept === 'FILL';
  const growsW = o.hug.longWidth > o.hug.defaultWidth + 20;
  const growsH = o.wrap.longHeight > o.wrap.defaultHeight + 5;
  return {
    status: VAZ ? 'ok' : 'ok-fallback-font',
    observed: o,
    decision: (VAZ ? '' : 'Vazirmatn is NOT installed: ran with Inter, the RTL result is not representative. ') + 'TEXT property keeps textAutoResize/FILL: ' + keeps + '; hug width grows: ' + growsW + '; wrapped height grows: ' + growsH + '.',
    flags: { vazirmatnAvailable: !!VAZ, textPropertyKeepsAutoResize: keeps, textPropertyRecomputesWidth: growsW, textPropertyWrapGrowsHeight: growsH },
  };
}

// =====================================================================================================
const EXPERIMENTS = [
  ['E1', 'createComponentFromNode keeps layout', ['promoteKeepsLayout'], E1],
  ['E2', 'Instance sizing (resize, FILL, hug growth)', ['useInstanceSizing', 'instanceHugGrowsWithText'], E2],
  ['E3', 'Throughput: manual build vs createInstance', ['instancesFasterThanManual', 'instanceBatchSize'], E3],
  ['E4', 'Icon instance: stroke scaling and nested overrides', ['iconStrokeScaleOnResize', 'nestedPaintOverrideBinds', 'nestedStrokeWeightOverridable'], E4],
  ['E5', 'Properties before combineAsVariants, hole in set', ['componentPropertiesBeforeCombine', 'variantHoleSupported'], E5],
  ['E6', 'Hidden child in HUG auto-layout', ['hiddenChildGapCollapses', 'booleanPropHidesChild'], E6],
  ['E7', 'Nested instance exposure and INSTANCE_SWAP', ['exposeNested', 'nestedPropsViaParent', 'swapViaSetProperties'], E7],
  ['E8', 'Cost of variable and text style binding', ['bindScope', 'bindMsPerCall'], E8],
  ['E9', 'Registry across pages (sharedPluginData search)', ['registryCrossPage', 'registryRootFindAll'], E9],
  ['E10', 'importComponentByKeyAsync with a local key', ['localKeyImportWorks'], E10],
  ['E11', 'Text style vs ranges and bound fill', ['textStyleKeepsRuns', 'textStyleKeepsBoundFill', 'styleBeforeRunsWorks'], E11],
  ['E12', 'Effect style with variable, gradient stop binding', ['effectStyleBindsVariable', 'gradientStopBindForm'], E12],
  ['E13', 'Text style letterSpacing / lineHeight fidelity', ['lineHeightFractionalExact', 'letterSpacingUnit'], E13],
  ['E14', 'Variable scopes, alias chain, code syntax', ['variableScopesPersist', 'aliasChainWorks', 'codeSyntaxWorks', 'multiModeAvailable'], E14],
  ['E15', 'Instance root props (clip, opacity, blend, rotation)', ['instanceRootPropsPreserved', 'instanceRotationSettable', 'instanceRootOverridable'], E15],
  ['E16', 'swapComponent vs mainComponent vs setProperties', ['swapKeepsOverrides', 'variantSwitchApi'], E16],
  ['E17', 'combineAsVariants with 24 members', ['combineLayoutHelperNeeded', 'variantSetOf24Ok'], E17],
  ['E18', 'Component in Section, description, links', ['componentInSectionOk', 'descriptionPersists', 'documentationLinksWork'], E18],
  ['E19', 'Manifest menu commands (figma.command)', ['menuCommandsAvailable', 'figmaCommandValue'], E19],
  ['E20', 'TEXT property with Vazirmatn', ['vazirmatnAvailable', 'textPropertyKeepsAutoResize', 'textPropertyRecomputesWidth', 'textPropertyWrapGrowsHeight'], E20],
];

// ---- cleanup ----
async function sweep(origPage) {
  // removes anything left with our prefix (previous crashed runs, late async work)
  const n = { pages: 0, nodes: 0, vars: 0, colls: 0, styles: 0 };
  try {
    for (const p of figma.root.children.slice()) {
      if (p.name.indexOf(PFX) === 0 && p !== figma.currentPage) { p.remove(); n.pages++; }
    }
  } catch (e) { n.error = 'pages: ' + msg(e); }
  try {
    const pg = origPage || figma.currentPage;
    for (const ch of pg.children.slice()) if (ch.name.indexOf(PFX) === 0) { ch.remove(); n.nodes++; }
  } catch (e) { n.error = (n.error || '') + ' nodes: ' + msg(e); }
  try {
    for (const c of await figma.variables.getLocalVariableCollectionsAsync()) if (c.name.indexOf(PFX) === 0) { c.remove(); n.colls++; }
    for (const v of await figma.variables.getLocalVariablesAsync()) if (v.name.indexOf(PFX) === 0 && !v.removed) { v.remove(); n.vars++; }
  } catch (e) { n.error = (n.error || '') + ' vars: ' + msg(e); }
  try {
    const all = (await figma.getLocalTextStylesAsync()).concat(await figma.getLocalEffectStylesAsync(), await figma.getLocalPaintStylesAsync());
    for (const s of all) if (s.name.indexOf(PFX) === 0) { s.remove(); n.styles++; }
  } catch (e) { n.error = (n.error || '') + ' styles: ' + msg(e); }
  return n;
}
async function cleanupAll(origPage) {
  const rep = { nodes: 0, vars: 0, colls: 0, styles: 0, pages: 0, errors: [] };
  const each = (arr, label, fn) => { for (const x of arr.slice().reverse()) { try { if (!x.removed) { fn(x); rep[label]++; } } catch (e) { rep.errors.push(label + ': ' + msg(e)); } } };
  each(C.nodes, 'nodes', (n) => n.remove());
  each(C.vars, 'vars', (v) => v.remove());
  each(C.colls, 'colls', (c) => c.remove());
  each(C.styles, 'styles', (s) => s.remove());
  try { if (origPage && figma.currentPage !== origPage) await figma.setCurrentPageAsync(origPage); } catch (e) { rep.errors.push('restore page: ' + msg(e)); }
  each(C.pages, 'pages', (p) => { if (p !== figma.currentPage) p.remove(); });
  rep.sweep = await sweep(origPage);
  C.nodes = []; C.vars = []; C.colls = []; C.styles = []; C.pages = [];
  return rep;
}

async function main() {
  const origPage = figma.currentPage;
  const meta = { plugin: 'figma-lift-verify-ds-1', startedAt: new Date().toISOString(), command: figma.command, editorType: figma.editorType, originalPage: origPage.name };
  const T0 = now();
  let cleanup = null;
  try {
    meta.preSweep = await sweep(origPage);
    // fonts
    try { await figma.loadFontAsync(INTER); meta.inter = true; } catch (e) { meta.inter = false; meta.interError = msg(e); }
    try {
      const fonts = await figma.listAvailableFontsAsync();
      const vz = fonts.filter((f) => f.fontName.family === 'Vazirmatn');
      meta.vazirmatnStyles = vz.map((f) => f.fontName.style);
      const pick = vz.find((f) => f.fontName.style === 'Regular') || vz[0];
      if (pick) { await figma.loadFontAsync(pick.fontName); VAZ = pick.fontName; }
    } catch (e) { meta.vazirmatnError = msg(e); }
    meta.vazirmatnAvailable = !!VAZ;
    if (!VAZ) post({ type: 'warn', text: 'Vazirmatn is not installed in this Figma: E20 runs with Inter and its RTL result is not representative. Install Vazirmatn (Google Fonts) and run again.' });
    // isolated work page
    try {
      const work = figma.createPage(); work.name = PFX + 'work'; C.pages.push(work);
      await figma.setCurrentPageAsync(work);
      meta.workPage = true;
    } catch (e) { meta.workPage = false; meta.workPageError = msg(e); }
    const probeOnly = figma.command === 'probe';
    for (const x of EXPERIMENTS) {
      if (probeOnly && x[0] !== 'E19') { FLAGS[x[0]] = x[2]; for (const k of x[2]) CFG[k] = null; R[x[0]] = { status: 'skipped', ms: 0, observed: null, decision: 'Skipped: probe command.' }; post({ type: 'progress', id: x[0], title: x[1], state: 'skipped' }); continue; }
      await exp(x[0], x[1], x[2], x[3]);
    }
  } catch (e) {
    meta.fatal = msg(e);
  } finally {
    try {
      cleanup = await cleanupAll(origPage);
      if (exp.timedOut) { await sleep(500); const second = await cleanupAll(origPage); cleanup.secondPass = second; }
    } catch (e) { cleanup = { fatal: msg(e) }; }
  }
  meta.totalMs = Math.round(now() - T0);
  meta.cleanup = cleanup;
  const out = {};
  for (const x of EXPERIMENTS) out[x[0]] = R[x[0]] || { status: 'not-run', ms: 0, observed: null, decision: 'not run (fatal error before this experiment)' };
  out.CFG = CFG;
  out._meta = meta;
  const json = JSON.stringify(out, null, 2);
  const cfgText = '// paste into the CFG object for the components/design-system plugins\n' + JSON.stringify(CFG, null, 2);
  post({ type: 'done', json: json, cfg: cfgText, summary: Object.keys(R).map((k) => k + ':' + R[k].status).join(' ') });
}

main().catch((e) => { post({ type: 'done', json: JSON.stringify({ fatal: msg(e) }), cfg: '{}', summary: 'fatal' }); });
