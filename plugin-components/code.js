// Backflow Components: builds the master components, component sets and icon components of a _library.json.
// Idempotent (registry = shared plugin data), never aborts on a single failure (ladder R0..R4, docs/PLUGIN-COMPONENTS.md).
// Reuses the build logic of plugin/code.js (copied, not imported: Figma plugins have no module system).
figma.showUI(__html__, { width: 420, height: 640 });

// ---------------------------------------------------------------------------------------------------------------------
// CFG: names follow docs/verify-ds.cfg.json (values measured in real Figma, docs/VERIFY-DS-RESULTS.md).
// ---------------------------------------------------------------------------------------------------------------------
const CFG = {
  promoteKeepsLayout: true,          // E1: createComponentFromNode keeps everything except the node type -> build, then promote
  useInstanceSizing: true,           // E2: resize()/FILL/HUG work on instances
  instanceBatchSize: 24,             // E3: yield to the UI every N nodes/instances
  iconStrokeScaleOnResize: false,    // E4: false -> set strokeWeight on nested vectors of resized icon instances
  nestedPaintOverrideBinds: true,
  nestedStrokeWeightOverridable: true,
  componentPropertiesBeforeCombine: true, // E5: add TEXT/BOOLEAN/INSTANCE_SWAP before combineAsVariants
  variantHoleSupported: false,       // E5: selecting a missing combination throws -> never request holes
  hiddenChildGapCollapses: true,     // E6
  booleanPropHidesChild: true,
  exposeNested: true,                // E7: isExposedInstance works
  nestedPropsViaParent: true,
  swapViaSetProperties: true,
  registryCrossPage: true,           // E9: loadAllPagesAsync + findAllWithCriteria per page
  registryRootFindAll: true,
  localKeyImportWorks: false,        // E10: keep everything in one file
  combineLayoutHelperNeeded: true,   // E17: variants stack after combine -> grid helper + resizeWithoutConstraints
  componentInSectionOk: true,        // E18
  descriptionPersists: true,         // E18: confidence tags live in the description
  // layout of the Backflow Components page
  layoutPad: 48, layoutGap: 48, layoutRowMax: 1800, variantGap: 24, variantPad: 32,
  // auto-layout switches copied from plugin/code.js
  autoLayout: true, strokeInLayout: true, allowNegativeSpacing: false, wrap: true, grid: true, gridAppendChildAt: false, fillTextWorks: true,
};
const NS = 'figmalift';              // shared plugin data namespace (registry convention, docs/PLUGIN-COMPONENTS.md)
const PAGE_NAME = 'Backflow Components';
const LEGACY_PAGE_NAMES = ['Lift Components']; // files built before 1.0 keep their page and are reused
const BUILD_VER = 'cmpplugin-1';     // part of 'sig': bump when the build algorithm changes in a way that must rebuild masters

// ======================================================================================================================
// REGISTRY HELPERS: copy these (liftRegistry, findMaster, pickVariant, parseVariantName) into other plugins.
// Convention: every master is a COMPONENT (single/icon) or COMPONENT_SET (variants) carrying
//   setSharedPluginData('figmalift', 'cmp', <library id>)   e.g. cmp_button_8ff3 or ic_5c8b835211
// Variant members inside a set are NOT tagged; they are named 'Prop=Value, Prop2=Value2' (keys of the library `variants.props`).
// Local keys are not importable (E10), so lookups are by this tag, in the same file, on any page.
// ======================================================================================================================
async function liftRegistry() {
  await figma.loadAllPagesAsync();
  const reg = new Map();
  for (const page of figma.root.children) {
    let found = [];
    try { found = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'], sharedPluginData: { namespace: 'figmalift', keys: ['cmp'] } }); } catch (e) { found = []; }
    for (const node of found) {
      const id = node.getSharedPluginData('figmalift', 'cmp');
      if (id && !reg.has(id)) reg.set(id, node);
    }
  }
  return reg;
}
let _liftRegCache = null;
async function findMaster(id, registry) {
  const reg = registry || _liftRegCache || (_liftRegCache = await liftRegistry());
  const n = reg.get(id);
  if (n && !n.removed) return n;
  if (!registry) { _liftRegCache = await liftRegistry(); const m = _liftRegCache.get(id); return m && !m.removed ? m : null; }
  return null;
}
function parseVariantName(name) {
  const o = {};
  for (const part of String(name).split(',')) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return o;
}
// master: COMPONENT -> itself; COMPONENT_SET -> child matching v (all keys of v), or defaultVariant when v is empty. null when the combination does not exist (a hole): never request holes.
function pickVariant(master, v) {
  if (!master) return null;
  if (master.type === 'COMPONENT') return master;
  const keys = v ? Object.keys(v) : [];
  if (!keys.length) return master.defaultVariant || master.children[0] || null;
  for (const ch of master.children) {
    if (ch.type !== 'COMPONENT') continue;
    const p = parseVariantName(ch.name);
    if (keys.every((k) => p[k] === v[k])) return ch;
  }
  return null;
}
// ===== end of registry helpers ========================================================================================

const say = (log) => figma.ui.postMessage({ log });
const tick = () => new Promise((r) => (typeof setTimeout === 'function' ? setTimeout(r, 0) : r()));
let cancelled = false, OPTS = {}, APPLY = false;
let S = null;              // run statistics
let CUR = null;            // current item {rung, flags}
let REG = new Map();       // id -> master node (existing in the file + created in this run)
let ICONS = new Map();     // icon id -> {comp, def}
let DEFS = new Map();      // component id -> LibComponent
let BUILT = new Map();     // source node -> Figma node (per master build)
let ops = 0;

const newStats = () => ({ created: 0, exists: 0, superseded: 0, metaUpdated: 0, failed: 0, cancelled: 0, sets: 0, iconsCreated: 0, nodes: 0, instances: 0, flagged: 0, r: { R0: 0, R1: 0, R2: 0, R3: 0, R4: 0 }, errors: [], flags: [] });
const err = (what, e) => { if (S.errors.length < 12) S.errors.push(what + ': ' + (e && e.message ? e.message : e)); };
// ladder bookkeeping: rung 1 = property/step skipped, 2 = bounds fixed, 3 = plain fallback for nested/icon, 4 = item failed
const flag = (rung, msg) => { if (CUR) CUR.rung = Math.max(CUR.rung, rung); S.flagged++; if (S.flags.length < 20) S.flags.push((CUR && CUR.id ? CUR.id + ': ' : '') + 'R' + rung + ' ' + msg); };
const safe = (label, fn) => { try { return fn(); } catch (e) { flag(1, label + ': ' + (e && e.message ? e.message : e)); return undefined; } };
const mustApply = (what) => { if (!APPLY) throw new Error('dry run: refused to ' + what); };

// ---------- hashing / signatures ----------
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
function hash(s) {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x85ebca6b); h2 ^= h2 >>> 13; }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
const sigOfComponent = (d) => BUILD_VER + ':' + hash(stable({ n: d.name, root: d.root, slots: d.slots, variants: d.variants || null }));
const sigOfIcon = (d) => BUILD_VER + ':' + hash(stable({ n: d.name, svg: d.svg, vb: d.vb, kind: d.kind, sw: d.strokeWidth || 0, dc: d.dominantColor || null }));

// ---------- fonts ----------
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
let available = new Map();
const fontCache = new Map();
function pickStyle(family, weight) {
  const styles = available.get(family);
  const w = Math.round((Number(weight) || 400) / 100) * 100;
  const order = [w, w + 100, w - 100, w + 200, w - 200, 400].filter((x) => x >= 100 && x <= 900);
  if (styles) for (const o of order) { const n = WEIGHT_NAMES[o]; if (styles.has(n)) return n; }
  return 'Regular';
}
async function fontFor(family, weight) {
  const fam = available.has(family) ? family : 'Inter';
  const style = pickStyle(fam, weight);
  const key = fam + '|' + style;
  if (!fontCache.has(key)) {
    try { await figma.loadFontAsync({ family: fam, style }); fontCache.set(key, { family: fam, style }); }
    catch (e) { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); fontCache.set(key, { family: 'Inter', style: 'Regular' }); }
  }
  return fontCache.get(key);
}
function collectFonts(n, set) {
  if (!n) return;
  if (n.t === 'text' && n.font) { set.set((n.font.family || '') + '|' + n.font.weight, [n.font.family, n.font.weight]); for (const r of n.runs || []) if (r.family || r.weight) set.set((r.family || n.font.family) + '|' + (r.weight || n.font.weight), [r.family || n.font.family, r.weight || n.font.weight]); }
  for (const c of n.children || []) collectFonts(c, set);
}

// ---------- colours / paints (shared logic of plugin/code.js, without variable binding: the tokens plugin owns bindings) ----------
const toHex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
function colorOfKey(k) { const m = /^c:([0-9a-f]{6})@(\d+)$/i.exec(k || ''); return m ? '#' + m[1].toLowerCase() : null; }
function parseCss(s) {
  if (!s) return null;
  let m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s.trim());
  if (m) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255 };
  m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (m) return { r: parseInt(m[1].slice(0, 2), 16) / 255, g: parseInt(m[1].slice(2, 4), 16) / 255, b: parseInt(m[1].slice(4, 6), 16) / 255 };
  return null;
}
function svgRootColor(svg, kind) {
  const open = /<svg[^>]*>/.exec(svg || ''); if (!open) return null;
  const m = new RegExp('\\s' + (kind === 'fill' ? 'fill' : 'stroke') + '="([^"]+)"').exec(open[0]);
  return m ? parseCss(m[1]) : null;
}
const solid = (c) => ({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a == null ? 1 : c.a });
function inv(m) {
  const [[a, b, tx], [c, d, ty]] = m, det = a * d - b * c || 1e-9;
  return [[d / det, -b / det, (b * ty - d * tx) / det], [-c / det, a / det, (c * tx - a * ty) / det]];
}
function gradPaint(g, w, h) {
  const n = g.stops.length;
  const stops = g.stops.map((s, i) => ({ position: Math.min(1, Math.max(0, s.pos != null ? s.pos : i / (n - 1))), color: { r: s.c.r, g: s.c.g, b: s.c.b, a: s.c.a } }));
  if (g.type === 'radial') { const k = 1 / 1.414; return { type: 'GRADIENT_RADIAL', gradientStops: stops, gradientTransform: [[k, 0, 0.5 - 0.5 * k], [0, k, 0.5 - 0.5 * k]] }; }
  const th = g.angle * Math.PI / 180, dx = Math.sin(th), dy = -Math.cos(th);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  const sx = 0.5 - (dx * L / 2) / w, sy = 0.5 - (dy * L / 2) / h, ex = 0.5 + (dx * L / 2) / w, ey = 0.5 + (dy * L / 2) / h;
  return { type: 'GRADIENT_LINEAR', gradientStops: stops, gradientTransform: inv([[ex - sx, -dy * L / w, sx], [ey - sy, dx * L / h, sy]]) };
}
function buildFills(n, w, h) {
  const fills = [];
  if (n.fill) fills.push(solid(n.fill));
  // images are never embedded in masters (library carries no image bytes); image layers are skipped
  if (n.layers) { for (const l of [...n.layers].reverse()) if (l.k === 'grad') fills.push(gradPaint(l, w, h)); }
  else if (n.grads) for (const g of [...n.grads].reverse()) fills.push(gradPaint(g, w, h));
  return fills;
}
const BLEND = (b) => String(b).toUpperCase().replace(/-/g, '_');
function styleBox(f, n, isFrame) {
  const w = Math.max(n.w, 1), h = Math.max(n.h, 1);
  safe('fills', () => { f.fills = buildFills(n, w, h); });
  if (n.stroke) safe('stroke', () => {
    f.strokes = [solid(n.stroke.c)]; f.strokeAlign = 'INSIDE';
    const [t, r, b, l] = n.stroke.w;
    if (t === r && r === b && b === l) f.strokeWeight = t;
    else { f.strokeTopWeight = t; f.strokeRightWeight = r; f.strokeBottomWeight = b; f.strokeLeftWeight = l; }
    if (n.stroke.style === 'dashed') f.dashPattern = [6, 4]; else if (n.stroke.style === 'dotted') f.dashPattern = [1, 3];
  });
  const rad = n.radiusArr || n.radius;
  if (rad) safe('radius', () => {
    if (Array.isArray(rad)) { const [tl, tr, br, bl] = rad; if (tl === tr && tr === br && br === bl) f.cornerRadius = tl; else { f.topLeftRadius = tl; f.topRightRadius = tr; f.bottomRightRadius = br; f.bottomLeftRadius = bl; } }
    else f.cornerRadius = rad;
  });
  const fx = [];
  for (const s of n.shadow || []) fx.push({ type: s.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: s.c, offset: { x: s.x, y: s.y }, radius: Math.max(0, s.blur), spread: s.spread || 0, visible: true, blendMode: 'NORMAL' });
  if (n.blur) fx.push({ type: 'LAYER_BLUR', radius: n.blur * 2, visible: true });
  if (n.bblur) fx.push({ type: 'BACKGROUND_BLUR', radius: n.bblur * 2, visible: true });
  if (fx.length) safe('effects', () => { f.effects = fx; });
  if (isFrame) safe('clip', () => { f.clipsContent = !!n.clip; });
  if (n.opacity != null) safe('opacity', () => { f.opacity = n.opacity; });
  if (n.blend) safe('blend', () => { f.blendMode = BLEND(n.blend); });
}
function place(node, n, parent) {
  safe('position', () => { node.x = n.x; node.y = n.y; });
  if (n.xf) safe('transform', () => { const [a, b, c, d, tx, ty] = n.xf; node.relativeTransform = [[a, c, tx], [b, d, ty]]; });
  if (n.ls && n.ls.cn && CFG.autoLayout && OPTS.autoLayout !== false) safe('constraints', () => { if ('constraints' in node) node.constraints = { horizontal: n.ls.cn[0], vertical: n.ls.cn[1] }; });
}
const alignOf = (f) => { const a = f.align; return a === 'center' ? 'CENTER' : (a === 'right' || (a === 'start' && f.dir === 'rtl') || (a === 'end' && f.dir !== 'rtl')) ? 'RIGHT' : 'LEFT'; };
const decoOf = (d) => (d && d.includes('underline') ? 'UNDERLINE' : d && d.includes('line-through') ? 'STRIKETHROUGH' : 'NONE');

// ---------- auto-layout support (copied from plugin/code.js) ----------
const DRIFT = new Map();
const isAutoMode = (m) => m === 'HORIZONTAL' || m === 'VERTICAL' || m === 'GRID';
const isAutoParent = (p) => !!p && p.type === 'FRAME' && isAutoMode(p.layoutMode);
const layoutOn = () => CFG.autoLayout && OPTS.autoLayout !== false;
const wantsAuto = (n) => layoutOn() && n.t === 'frame' && n.ls && n.ls.k && n.ls.k !== 'N' && n.children && n.children.length && !(n.ls.k === 'G' && !CFG.grid) && !(n.ls.k === 'W' && !CFG.wrap);
const isAbsKid = (d) => !!(d && d.ls && d.ls.abs);

async function bump() { S.nodes++; ops++; if (ops % CFG.instanceBatchSize === 0) await tick(); }
async function build(n, parent) {
  try { const r = await buildInner(n, parent); if (r) BUILT.set(n, r); await bump(); return r; }
  catch (e) { flag(1, 'node ' + ((n && n.name) || '?') + ': ' + (e && e.message ? e.message : e)); err((n && n.name) || 'node', e); return null; }
}
function attach(parent, node, n) {
  if (parent.layoutMode === 'GRID' && n.ls && n.ls.gp && layoutOn()) {
    const [r, c] = n.ls.gp;
    try {
      if (CFG.gridAppendChildAt && parent.appendChildAt) { parent.appendChildAt(node, r, c); return; }
      parent.appendChild(node);
      if (node.gridRowAnchorIndex !== r || node.gridColumnAnchorIndex !== c) node.setGridChildPosition(r, c);
      return;
    } catch (e) { flag(1, 'grid place: ' + e.message); if (!node.parent) parent.appendChild(node); return; }
  }
  parent.appendChild(node);
}
function makeAbsolute(node, n, parent) { safe('absolute', () => { node.layoutPositioning = 'ABSOLUTE'; }); place(node, n, parent); }
function postPlace(node, n, parent) {
  if (isAutoParent(parent) && n.ls && n.ls.abs && layoutOn()) makeAbsolute(node, n, parent);
  else if (isAutoParent(parent) && layoutOn() && n.ls && n.ls.s) return;
  else place(node, n, parent);
}

async function buildText(n, parent, managed, L, w, h) {
  const t = figma.createText();
  const f = n.font;
  t.fontName = await fontFor(f.family, f.weight);
  if (managed) safe('textMode', () => { t.textAutoResize = L.s[0] === 'H' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT'; });
  t.characters = n.text;
  t.fontSize = Math.max(f.size, 1);
  safe('lineHeight', () => { if (f.lh) t.lineHeight = { unit: 'PIXELS', value: f.lh }; else if (L && L.tx && L.tx.lh) t.lineHeight = { unit: 'PIXELS', value: L.tx.lh }; });
  safe('letterSpacing', () => { if (f.ls) t.letterSpacing = { unit: 'PIXELS', value: f.ls }; });
  safe('textFill', () => { t.fills = [solid(f.color)]; });
  safe('decoration', () => { const d = decoOf(f.deco); if (d !== 'NONE') t.textDecoration = d; });
  safe('align', () => { t.textAlignHorizontal = L && L.tx && L.tx.ta ? { L: 'LEFT', C: 'CENTER', R: 'RIGHT' }[L.tx.ta] : alignOf(f); });
  if (f.shadow) safe('textShadow', () => { t.effects = [{ type: 'DROP_SHADOW', color: f.shadow.c, offset: { x: f.shadow.x, y: f.shadow.y }, radius: Math.max(0, f.shadow.blur), visible: true, blendMode: 'NORMAL' }]; });
  const len = t.characters.length;
  for (const r of n.runs || []) {
    const s = r.s, e = Math.min(r.e, len);
    if (!(e > s)) continue;
    try {
      if (r.family || r.weight) t.setRangeFontName(s, e, await fontFor(r.family || f.family, r.weight || f.weight));
      if (r.size) t.setRangeFontSize(s, e, Math.max(r.size, 1));
      if (r.color) t.setRangeFills(s, e, [solid(r.color)]);
      if (r.deco) t.setRangeTextDecoration(s, e, decoOf(r.deco));
    } catch (er) { flag(1, 'run: ' + er.message); }
  }
  attach(parent, t, n);
  if (L && L.abs && isAutoParent(parent)) safe('absolute', () => { t.layoutPositioning = 'ABSOLUTE'; });
  if (!managed) {
    safe('textBox', () => {
      if (n.fixed) { t.textAutoResize = 'HEIGHT'; t.resize(w + 1, t.height); t.x = n.x; } else { t.textAutoResize = 'NONE'; t.resize(w + 2, h); t.x = n.x - 1; }
      t.y = n.y;
    });
    if (L && L.cn) safe('constraints', () => { t.constraints = { horizontal: L.cn[0], vertical: L.cn[1] }; });
  }
  t.name = (n.text.replace(/\s+/g, ' ').slice(0, 40)) || 'text';
  return t;
}

// icon instance (nested icon node whose cmp points at an icon component). E4: stroke does not scale on resize -> strokeWeight override.
function vectorsOf(inst, vecPaths) {
  const out = [];
  for (const p of vecPaths || []) { let cur = inst; for (const i of p) { cur = cur && cur.children && cur.children[i]; } if (cur && 'strokes' in cur) out.push(cur); }
  if (out.length) return out;
  const walk = (x) => { for (const c of x.children || []) { if (c.type === 'VECTOR' || c.type === 'BOOLEAN_OPERATION' || c.type === 'LINE' || c.type === 'ELLIPSE' || c.type === 'RECTANGLE' || c.type === 'STAR' || c.type === 'POLYGON') out.push(c); if (c.children) walk(c); } };
  walk(inst);
  return out;
}
function styleIconInstance(inst, def, n, w, h, masterColor) {
  const vb = def.vb && def.vb[2] ? def.vb[2] : 24;
  const vecs = vectorsOf(inst, def.vecPaths);
  if (def.kind === 'stroke' && def.strokeWidth && !CFG.iconStrokeScaleOnResize && Math.abs(w - vb) > 0.01 && CFG.nestedStrokeWeightOverridable) {
    safe('icon strokeWeight', () => { for (const v of vecs) v.strokeWeight = def.strokeWidth * w / vb; });
  }
  const own = svgRootColor(n.svg, def.kind);
  if (own && (!masterColor || toHex(own) !== toHex(masterColor))) {
    safe('icon colour', () => { for (const v of vecs) { if (def.kind === 'fill') v.fills = [{ type: 'SOLID', color: own }]; else v.strokes = [{ type: 'SOLID', color: own }]; } });
  }
}
function tryIconInstance(n, parent, w, h) {
  const ic = ICONS.get(n.cmp.id);
  if (!ic) { flag(3, 'icon ' + n.cmp.id + ' has no master: plain svg'); return null; }
  let inst = null;
  try {
    inst = ic.comp.createInstance();
    S.instances++;
    if (CFG.useInstanceSizing) safe('icon size', () => inst.resize(w, h));
    attach(parent, inst, n);
    postPlace(inst, n, parent);
    if (n.opacity != null) safe('opacity', () => { inst.opacity = n.opacity; });
    styleIconInstance(inst, ic.def, n, w, h, colorOfKey(ic.def.dominantColor) ? parseCss(colorOfKey(ic.def.dominantColor)) : null);
    return inst;
  } catch (e) { flag(3, 'icon instance ' + n.cmp.id + ': ' + e.message); try { if (inst) inst.remove(); } catch (x) { /* ignore */ } return null; }
}

// nested component instance. The nested node's own `cmp` (v, ov) is authoritative (CONTRACT-NOTES A.6).
function propKey(inst, name, type) {
  const props = inst.componentProperties || {};
  for (const k of Object.keys(props)) { if (k.replace(/#\d+:\d+$/, '') === name && (!type || props[k].type === type)) return k; }
  return null;
}
function applyNestedOverrides(inst, def, ovs) {
  for (const o of ovs || []) {
    if (String(o.s).indexOf('.') >= 0) continue; // dotted overrides are carried by the nested node's own cmp
    const sl = def && def.slots[Number(o.s)];
    if (!sl) { flag(1, 'override slot ' + o.s + ' unknown'); continue; }
    safe('override ' + sl.name, () => {
      if ('t' in o && sl.kind === 'text') { const k = propKey(inst, sl.name, 'TEXT'); if (!k) throw new Error('no TEXT property ' + sl.name); inst.setProperties({ [k]: o.t }); }
      else if ('b' in o && sl.kind === 'bool') { const k = propKey(inst, sl.name, 'BOOLEAN'); if (!k) throw new Error('no BOOLEAN property ' + sl.name); inst.setProperties({ [k]: !!o.b }); }
      else if ('ic' in o && sl.kind === 'swap') { const k = propKey(inst, sl.name, 'INSTANCE_SWAP'); const ic = ICONS.get(o.ic); if (!k || !ic) throw new Error('swap target missing ' + o.ic); inst.setProperties({ [k]: ic.comp.id }); }
      // img / fill / inst overrides are direct sublayer overrides done by the importer, not baked into masters
    });
  }
}
function tryCmpInstance(n, parent, w, h) {
  const master = REG.get(n.cmp.id);
  if (!master) { flag(3, 'nested ' + n.cmp.id + ' has no master: plain frame'); return null; }
  let inst = null;
  try {
    let comp = pickVariant(master, n.cmp.v);
    if (!comp) { flag(1, 'nested ' + n.cmp.id + ' variant ' + stable(n.cmp.v) + ' missing (hole): default variant'); comp = pickVariant(master, null); }
    if (!comp) throw new Error('no component to instantiate');
    inst = comp.createInstance();
    S.instances++;
    attach(parent, inst, n);
    postPlace(inst, n, parent);
    if (CFG.useInstanceSizing) {
      const s = (n.ls && n.ls.s) || ['F', 'F'];
      if (s[0] === 'F' || s[1] === 'F') safe('instance size', () => inst.resize(s[0] === 'F' ? w : inst.width, s[1] === 'F' ? h : inst.height));
    }
    if (n.opacity != null) safe('opacity', () => { inst.opacity = n.opacity; });
    applyNestedOverrides(inst, DEFS.get(n.cmp.id), n.cmp.ov);
    return inst;
  } catch (e) { flag(3, 'nested instance ' + n.cmp.id + ': ' + e.message); try { if (inst) inst.remove(); } catch (x) { /* ignore */ } return null; }
}

async function buildInner(n, parent) {
  const w = Math.max(n.w, 1), h = Math.max(n.h, 1);
  const L = layoutOn() ? n.ls : null;
  const managed = !!(L && L.s && !L.abs && isAutoParent(parent));
  if (n.t === 'text') return buildText(n, parent, managed, L, w, h);
  if (n.t === 'svg') {
    if (n.cmp && n.cmp.id && /^ic_/.test(n.cmp.id)) { const i = tryIconInstance(n, parent, w, h); if (i) return i; }
    try {
      const s = figma.createNodeFromSvg(n.svg);
      s.name = n.name && n.name !== 'svg' ? n.name : 'icon';
      safe('svgSize', () => s.resize(w, h));
      attach(parent, s, n); postPlace(s, n, parent);
      if (n.opacity != null) safe('opacity', () => { s.opacity = n.opacity; });
      return s;
    } catch (e) {
      flag(1, 'svg: ' + e.message);
      const r = figma.createRectangle(); r.name = 'icon (svg failed)'; r.resize(w, h); r.fills = []; parent.appendChild(r); r.x = n.x; r.y = n.y; return r;
    }
  }
  if (n.t === 'img') {
    const r = figma.createRectangle(); r.name = n.alt ? 'image · ' + n.alt.slice(0, 30) : 'image'; r.resize(w, h);
    attach(parent, r, n);
    styleBox(r, Object.assign({}, n, { fill: null, layers: null, grads: null }), false);
    safe('imgFills', () => { r.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.3 }]; });
    postPlace(r, n, parent);
    return r;
  }
  if (n.cmp && n.cmp.id && /^cmp_/.test(n.cmp.id) && !n.__root) { const i = tryCmpInstance(n, parent, w, h); if (i) return i; }
  const f = figma.createFrame();
  f.name = n.name || 'frame';
  f.resize(w, h);
  styleBox(f, n, true);
  attach(parent, f, n);
  postPlace(f, n, parent);
  let auto = wantsAuto(n);
  if (auto) { try { configureAuto(f, n, w, h); } catch (e) { auto = false; flag(1, 'autoLayout ' + (n.name || '') + ': ' + e.message); safe('noLayout', () => { f.layoutMode = 'NONE'; }); } }
  const kids = [];
  for (const c of n.children || []) { const k = await build(c, f); if (k) kids.push({ k, d: c }); }
  if (auto) {
    try { finishAuto(f, n, kids, w, h); } catch (e) { flag(1, 'finishAuto ' + (n.name || '') + ': ' + e.message); freezeToAbsolute(f, n, kids, w, h); }
  }
  return f;
}

function configureAuto(f, n, w, h) {
  const L = n.ls;
  if (L.k === 'G') {
    f.layoutMode = 'GRID'; f.gridColumnCount = L.cols.length; f.gridRowCount = L.rows.length; f.gridColumnGap = L.cg || 0; f.gridRowGap = L.rg || 0;
    L.cols.forEach((c, i) => { const t = f.gridColumnSizes[i]; t.type = c.t; if (c.t !== 'HUG' && c.v != null) t.value = c.v; });
    L.rows.forEach((r, i) => { const t = f.gridRowSizes[i]; t.type = r.t; if (r.t !== 'HUG' && r.v != null) t.value = r.v; });
  } else {
    f.layoutMode = L.k === 'V' ? 'VERTICAL' : 'HORIZONTAL';
    if (L.k === 'W') { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = L.g2 || 0; f.counterAxisAlignContent = 'AUTO'; }
    f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
    f.itemSpacing = Math.max(CFG.allowNegativeSpacing ? -1e6 : 0, L.g || 0);
    f.primaryAxisAlignItems = L.pa || 'MIN'; f.counterAxisAlignItems = L.ca || 'MIN';
  }
  const bw = L.bw || [0, 0, 0, 0];
  const strokeIn = CFG.strokeInLayout && !!n.stroke;
  const p = (L.p || [0, 0, 0, 0]).map((v, i) => Math.max(0, v - (strokeIn ? bw[i] : 0)));
  f.paddingTop = p[0]; f.paddingRight = p[1]; f.paddingBottom = p[2]; f.paddingLeft = p[3];
  if (n.stroke) safe('strokesIncludedInLayout', () => { f.strokesIncludedInLayout = strokeIn; });
  f.resize(w, h);
}
function sizeText(k, d, s) {
  const tx = (d.ls && d.ls.tx) || {};
  safe('textSizing', () => {
    if (s[0] === 'H') k.textAutoResize = 'WIDTH_AND_HEIGHT';
    else {
      k.textAutoResize = s[1] === 'F' ? 'NONE' : 'HEIGHT';
      k.resize(Math.max(d.w, 1), s[1] === 'F' ? Math.max(d.h, 1) : k.height);
      if (s[0] === 'L' && CFG.fillTextWorks) { k.layoutSizingHorizontal = 'FILL'; if (k.width < 4) { k.layoutSizingHorizontal = 'FIXED'; k.resize(Math.max(d.w, 1), k.height); } }
    }
    if (tx.tr) { k.textTruncation = 'ENDING'; k.maxLines = tx.tr; }
  });
}
function sizeFrameLike(k, d, s) {
  const canHug = (k.type === 'FRAME' || k.type === 'COMPONENT' || k.type === 'INSTANCE') && isAutoMode(k.layoutMode);
  const ax = (prop, v) => { if (v === 'L') safe(prop, () => { k[prop] = 'FILL'; }); else if (v === 'H' && canHug) safe(prop, () => { k[prop] = 'HUG'; }); };
  ax('layoutSizingHorizontal', s[0]); ax('layoutSizingVertical', s[1]);
}
function applyMinMax(k, d) {
  const L = d.ls; if (!L) return;
  safe('minmax', () => {
    if (L.mn) { if (L.mn[0] != null) k.minWidth = L.mn[0]; if (L.mn[1] != null) k.minHeight = L.mn[1]; }
    if (L.mx) { if (L.mx[0] != null) k.maxWidth = L.mx[0]; if (L.mx[1] != null) k.maxHeight = L.mx[1]; }
  });
}
function finishAuto(f, n, kids, w, h) {
  for (const { k, d } of kids) {
    const L = d.ls; if (!L || L.abs || !L.s) continue;
    if (k.type === 'TEXT') sizeText(k, d, L.s); else sizeFrameLike(k, d, L.s);
    applyMinMax(k, d);
  }
  if (n.ls.k === 'G') for (const { k, d } of kids) if (d.ls && d.ls.gp && !d.ls.abs) safe('gridSpan', () => { if (d.ls.gp[2] > 1) k.gridRowSpan = d.ls.gp[2]; if (d.ls.gp[3] > 1) k.gridColumnSpan = d.ls.gp[3]; });
  if (OPTS.verifyLayout !== false) verifyNode(f, n, kids, w, h);
}
// compact version of the verification ladder of plugin/code.js: F0 plan, F1 fixed sizes, F3 freeze to absolute
function deviates(kids) {
  let bad = 0;
  for (const { k, d } of kids) {
    if (isAbsKid(d) || (d.ls && d.ls.sp) || k.removed) continue;
    const dx = Math.abs(k.x - d.x), dy = Math.abs(k.y - d.y), dw = Math.abs(k.width - d.w), dh = Math.abs(k.height - d.h);
    const tol = k.type === 'TEXT' ? 6 : 3;
    if (dx > tol + 0.2 * d.w || dy > tol + 0.5 * d.h || (k.type !== 'TEXT' && (dw > tol || dh > tol))) bad++;
  }
  return bad;
}
function degradeFixed(kids) {
  for (const { k, d } of kids) {
    if (isAbsKid(d) || (d.ls && d.ls.sp)) continue;
    safe('fixKid', () => { if (k.type === 'TEXT') { const multi = d.ls && d.ls.tx && d.ls.tx.l > 1; k.textAutoResize = multi ? 'HEIGHT' : 'NONE'; k.resize(Math.max(d.w, 1), multi ? k.height : Math.max(d.h, 1)); } else if (k.type !== 'INSTANCE') k.resize(Math.max(d.w, 1), Math.max(d.h, 1)); });
  }
}
function freezeToAbsolute(f, n, kids, w, h) {
  safe('freeze', () => { f.layoutMode = 'NONE'; });
  safe('freezeSize', () => f.resize(w, h));
  for (const { k, d } of kids) {
    if (d.ls && d.ls.sp) { safe('rmSpacer', () => { k.remove(); k.removed = true; }); continue; }
    safe('freezeKid', () => { if (k.type === 'TEXT') { const multi = d.ls && d.ls.tx && d.ls.tx.l > 1; k.textAutoResize = multi ? 'HEIGHT' : 'NONE'; k.resize(Math.max(d.w, 1), multi ? k.height : Math.max(d.h, 1)); } else if (k.type !== 'INSTANCE') k.resize(Math.max(d.w, 1), Math.max(d.h, 1)); k.x = d.x; k.y = d.y; });
  }
}
function verifyNode(f, n, kids, w, h) {
  if (!deviates(kids)) return;
  degradeFixed(kids);
  if (!deviates(kids)) return;
  freezeToAbsolute(f, n, kids, w, h);
  flag(1, 'auto-layout of ' + (n.name || 'frame') + ' degraded to absolute');
}

// ---------- master building ----------
const srcAt = (root, path) => { let c = root; for (const i of path) { c = c.children && c.children[i]; if (!c) throw new Error('slot path ' + path.join('/') + ' not in root'); } return c; };
function idxPath(node, frame) {
  const arr = []; let cur = node;
  while (cur !== frame) { const p = cur.parent; if (!p) return null; arr.unshift(p.children.indexOf(cur)); cur = p; }
  return arr;
}
async function buildMaster(def, root, name, host) {
  BUILT = new Map();
  const rootCopy = Object.assign({}, root, { __root: true });
  const frame = await build(rootCopy, host);
  if (!frame) throw new Error('build returned nothing');
  // slot targets are resolved BEFORE promotion (index path from the root frame), the promoted component keeps the child order
  const targets = def.slots.map((sl) => {
    try { const src = sl.path.length ? srcAt(rootCopy, sl.path) : rootCopy; const b = BUILT.get(src); return b ? idxPath(b, frame) : null; }
    catch (e) { return null; }
  });
  let comp;
  try { comp = figma.createComponentFromNode(frame); } catch (e) { try { frame.remove(); } catch (x) { /* ignore */ } throw e; }
  comp.name = name || def.name;
  return { comp, targets };
}
function mergeRefs(map, node, r) { map.set(node, Object.assign(map.get(node) || {}, r)); }
function addSlots(comp, def, targets) {
  const refs = new Map(), names = new Set();
  const nodeAt = (p) => { let c = comp; for (const i of p) { c = c.children && c.children[i]; if (!c) throw new Error('target node vanished after promotion'); } return c; };
  def.slots.forEach((sl, i) => {
    let pname = sl.name || ('Slot ' + sl.s); let k = 2;
    while (names.has(pname)) pname = sl.name + ' ' + k++;
    names.add(pname);
    try {
      if (sl.kind === 'img' || sl.kind === 'fill') return; // direct sublayer overrides (importer), no property type exists
      if (sl.kind === 'slot') { flag(1, 'slot kind SLOT not supported yet (P2): ' + sl.name); return; }
      const tp = targets[i]; if (!tp) throw new Error('target node was not built');
      const node = nodeAt(tp);
      if (sl.kind === 'text') {
        if (node.type !== 'TEXT') throw new Error('target is ' + node.type);
        if (sl.fixedRuns) { flag(1, 'text slot with runs gets no property: ' + sl.name); return; }
        const dv = typeof sl.default === 'string' ? sl.default : node.characters;
        if (node.characters !== dv) node.characters = dv;
        mergeRefs(refs, node, { characters: comp.addComponentProperty(pname, 'TEXT', dv) });
      } else if (sl.kind === 'bool') {
        const dv = sl.default !== false;
        mergeRefs(refs, node, { visible: comp.addComponentProperty(pname, 'BOOLEAN', dv) });
        if (!dv) node.visible = false;
      } else if (sl.kind === 'swap') {
        if (node.type !== 'INSTANCE') throw new Error('icon slot target is ' + node.type + ' (icon master missing?)');
        const ic = ICONS.get(sl.default); if (!ic) throw new Error('default icon ' + sl.default + ' has no master');
        mergeRefs(refs, node, { mainComponent: comp.addComponentProperty(pname, 'INSTANCE_SWAP', ic.comp.id) });
      } else if (sl.kind === 'inst') {
        if (node.type !== 'INSTANCE') throw new Error('nested slot target is ' + node.type);
        if (CFG.exposeNested) node.isExposedInstance = true;
      }
    } catch (e) { flag(1, 'slot ' + sl.s + ' ' + sl.name + ': ' + (e && e.message ? e.message : e)); }
  });
  for (const [node, r] of refs) safe('property references', () => { node.componentPropertyReferences = r; });
}
function rootSizing(comp, root) {
  const L = root.ls; if (!L || !L.s || !isAutoMode(comp.layoutMode)) return;
  if (L.s[0] === 'H' || L.s[0] === 'L') safe('root hug x', () => { comp.layoutSizingHorizontal = 'HUG'; });
  if (L.s[1] === 'H' || L.s[1] === 'L') safe('root hug y', () => { comp.layoutSizingVertical = 'HUG'; });
}
function verifyRoot(comp, root) {
  const L = root.ls, auto = isAutoMode(comp.layoutMode);
  const fx = !(auto && L && L.s && L.s[0] !== 'F'), fy = !(auto && L && L.s && L.s[1] !== 'F');
  const dw = fx ? Math.abs(comp.width - root.w) : 0, dh = fy ? Math.abs(comp.height - root.h) : 0;
  if (dw > 1 || dh > 1) {
    flag(2, comp.name + ' root bounds off by ' + dw.toFixed(1) + 'x' + dh.toFixed(1) + ': resized');
    safe('root resize', () => comp.resize(fx ? root.w : comp.width, fy ? root.h : comp.height));
    if (Math.abs(fx ? comp.width - root.w : 0) > 1 || Math.abs(fy ? comp.height - root.h : 0) > 1) flag(3, comp.name + ' root bounds still deviate');
  }
}
async function makeSingle(def, host) {
  if (!def.root) throw new Error('library entry has no root');
  const { comp, targets } = await buildMaster(def, def.root, def.name, host);
  addSlots(comp, def, targets);
  rootSizing(comp, def.root);
  verifyRoot(comp, def.root);
  return comp;
}
async function makeSet(def, host) {
  if (!def.variants.members || !def.variants.members.length) throw new Error('variants without members');
  const order = Object.keys(def.variants.props);
  const comps = [], seen = new Set();
  try {
    for (const m of def.variants.members) {
      const keys = order.concat(Object.keys(m.v).filter((k) => order.indexOf(k) < 0));
      const vname = keys.filter((k) => m.v[k] != null).map((k) => k + '=' + m.v[k]).join(', ');
      if (seen.has(vname)) { flag(1, 'duplicate variant ' + vname + ' skipped'); continue; }
      seen.add(vname);
      const { comp, targets } = await buildMaster(def, m.root, vname, host);
      comps.push(comp);
      addSlots(comp, def, targets);              // E5: properties BEFORE combineAsVariants
      rootSizing(comp, m.root);
      verifyRoot(comp, m.root);
    }
    if (!comps.length) throw new Error('no variant members built');
    const set = figma.combineAsVariants(comps, host);
    set.name = def.name;
    S.sets++;
    if (CFG.combineLayoutHelperNeeded) layoutSet(set, def);
    return set;
  } catch (e) { for (const c of comps) { try { c.remove(); } catch (x) { /* ignore */ } } throw e; }
}
// E17: combined variants stack on top of each other: grid by property values (first property = columns, the others = rows)
function layoutSet(set, def) {
  const props = def.variants.props, names = Object.keys(props);
  const colP = names[0], rowPs = names.slice(1);
  const kids = set.children.filter((c) => c.type === 'COMPONENT');
  const rowKeys = [];
  const rk = (v) => rowPs.map((p) => v[p]).join('|');
  const combos = (i) => (i >= rowPs.length ? [[]] : [].concat(...props[rowPs[i]].map((val) => combos(i + 1).map((rest) => [val].concat(rest)))));
  for (const c of combos(0)) rowKeys.push(c.join('|'));
  let maxW = 0, maxH = 0;
  for (const k of kids) { maxW = Math.max(maxW, k.width); maxH = Math.max(maxH, k.height); }
  let usedCols = 0, usedRows = 0;
  for (const k of kids) {
    const v = parseVariantName(k.name);
    const ci = Math.max(0, props[colP].indexOf(v[colP])), ri = Math.max(0, rowKeys.indexOf(rk(v)));
    usedCols = Math.max(usedCols, ci + 1); usedRows = Math.max(usedRows, ri + 1);
    safe('variant position', () => { k.x = CFG.variantPad + ci * (maxW + CFG.variantGap); k.y = CFG.variantPad + ri * (maxH + CFG.variantGap); });
  }
  safe('set resize', () => set.resizeWithoutConstraints(CFG.variantPad * 2 + usedCols * maxW + Math.max(0, usedCols - 1) * CFG.variantGap, CFG.variantPad * 2 + usedRows * maxH + Math.max(0, usedRows - 1) * CFG.variantGap));
}
// icons: one component per LibIcon, built with createNodeFromSvg at the viewBox size
function iconSvg(ic) {
  const col = colorOfKey(ic.dominantColor) || '#000000';
  return String(ic.svg).replace(/currentColor/g, col);
}
async function makeIcon(ic, name, host) {
  const frame = figma.createNodeFromSvg(iconSvg(ic));
  host.appendChild(frame);
  let comp;
  try { comp = figma.createComponentFromNode(frame); } catch (e) { try { frame.remove(); } catch (x) { /* ignore */ } throw e; }
  comp.name = name;
  return comp;
}

// ---------- tags, description, supersede ----------
function describe(def) {
  const lines = [(def.band === 'review' ? '[REVIEW] ' : '') + 'Backflow ' + def.id + ' | confidence ' + def.conf + ' (' + def.band + ')'];
  if (def.band === 'review') lines.push('Needs a designer check: name, variants and slots are heuristics.');
  if (def.stats) lines.push('Seen ' + def.stats.occ + 'x on ' + def.stats.screens + ' screens.');
  if (def.ds) lines.push('Possible design-system match: ' + def.ds.name + ' (score ' + def.ds.score + ', mode ' + def.ds.mode + ', not instantiated).');
  for (const n of def.notes || []) lines.push(n);
  return lines.join('\n');
}
function tag(node, id, sig, extra) {
  node.setSharedPluginData(NS, 'cmp', id);
  node.setSharedPluginData(NS, 'sig', sig);
  node.setSharedPluginData(NS, 'ver', BUILD_VER);
  for (const k of Object.keys(extra || {})) node.setSharedPluginData(NS, k, String(extra[k]));
}
function supersede(old) {
  const d = new Date().toISOString().slice(0, 10);
  old.setSharedPluginData(NS, 'cmp', '');
  old.setSharedPluginData(NS, 'superseded', d);
  old.name = old.name.replace(/ \(superseded [^)]*\)$/, '') + ' (superseded ' + d + ')';
}

// ---------- hosts (page or section fallback) and layout ----------
async function getHost() {
  await figma.loadAllPagesAsync();
  let page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME)
    || figma.root.children.find((p) => p.type === 'PAGE' && LEGACY_PAGE_NAMES.includes(p.name)) || null;
  if (page) return { kind: 'page', page, host: page, note: 'page "' + page.name + '" exists' };
  if (!APPLY) return { kind: 'missing', note: 'page "' + PAGE_NAME + '" missing: would be created (falls back to a Section on the current page when the plan limits pages)' };
  try { page = figma.createPage(); page.name = PAGE_NAME; return { kind: 'page', page, host: page, note: 'page "' + PAGE_NAME + '" created' }; }
  catch (e) {
    const cur = figma.currentPage;
    let sec = cur.children.find((c) => c.type === 'SECTION' && (c.name === PAGE_NAME || LEGACY_PAGE_NAMES.includes(c.name)));
    if (!sec) { sec = figma.createSection(); sec.name = PAGE_NAME; let right = 0; for (const c of cur.children) if (c !== sec) right = Math.max(right, c.x + c.width); sec.x = right ? right + 200 : 0; sec.y = 0; cur.appendChild(sec); }
    return { kind: 'section', page: cur, host: sec, note: 'FALLBACK: could not create a page (' + (e && e.message ? e.message : e) + '); using Section "' + PAGE_NAME + '" on page "' + cur.name + '"' };
  }
}
const containers = new Map();
function containerFor(H, group) {
  if (containers.has(group)) return containers.get(group);
  let c = null;
  for (const ch of H.host.children) if ((ch.type === 'SECTION' || ch.type === 'FRAME') && ch.name === group && ch.getSharedPluginData(NS, 'group') === group) { c = ch; break; }
  if (!c) {
    if (H.kind === 'page') c = figma.createSection(); // sections cannot nest: in the fallback the group is a plain frame inside the Lift section
    else { c = figma.createFrame(); c.fills = []; c.clipsContent = false; }
    c.name = group; c.setSharedPluginData(NS, 'group', group);
    H.host.appendChild(c);
    let bottom = 0; for (const ch of H.host.children) if (ch !== c) bottom = Math.max(bottom, ch.y + ch.height);
    c.x = H.kind === 'page' ? 0 : CFG.layoutPad; c.y = bottom ? bottom + CFG.layoutGap * 2 : (H.kind === 'page' ? 0 : CFG.layoutPad);
    c.setSharedPluginData(NS, 'new', '1');
    if (H.kind === 'page') c.resizeWithoutConstraints(400, 400); else c.resize(400, 400);
  }
  containers.set(group, c);
  return c;
}
function layoutInto(c, nodes) {
  const PAD = CFG.layoutPad, GAP = CFG.layoutGap, MAXW = CFG.layoutRowMax;
  let cx = PAD, cy = PAD, rowH = 0;
  const others = c.children.filter((x) => nodes.indexOf(x) < 0);
  if (others.length) { let b = 0; for (const o of others) b = Math.max(b, o.y + o.height); cy = b + GAP; }
  for (const n of nodes) {
    if (cx > PAD && cx + n.width > MAXW) { cx = PAD; cy += rowH + GAP; rowH = 0; }
    n.x = cx; n.y = cy; cx += n.width + GAP; rowH = Math.max(rowH, n.height);
  }
  let r = 0, b = 0; for (const o of c.children) { r = Math.max(r, o.x + o.width); b = Math.max(b, o.y + o.height); }
  const W = Math.max(200, r + PAD), Hh = Math.max(200, b + PAD);
  if (c.type === 'SECTION') c.resizeWithoutConstraints(W, Hh); else c.resize(W, Hh);
}

// ---------- plan ----------
function depsOf(d) {
  const out = new Set();
  const walk = (n) => { if (!n) return; if (n.cmp && n.cmp.id && /^cmp_/.test(n.cmp.id) && n.cmp.id !== d.id) out.add(n.cmp.id); for (const c of n.children || []) walk(c); };
  walk(d.root); if (d.variants) for (const m of d.variants.members) walk(m.root);
  return out;
}
function orderComponents(comps) {
  const byId = new Map(comps.map((c) => [c.id, c])), done = new Set(), visiting = new Set(), out = [], cyc = [];
  const visit = (c) => {
    if (done.has(c.id)) return;
    if (visiting.has(c.id)) { cyc.push(c.id); return; }
    visiting.add(c.id);
    for (const dep of depsOf(c)) { const dc = byId.get(dep); if (dc) visit(dc); }
    visiting.delete(c.id); done.add(c.id); out.push(c);
  };
  for (const c of comps) visit(c);
  return { out, cyc };
}
function iconNames(icons) {
  const count = new Map(); for (const i of icons) count.set(i.name, (count.get(i.name) || 0) + 1);
  return new Map(icons.map((i) => [i.id, 'Icon/' + i.name + (count.get(i.name) > 1 ? ' (' + i.id.replace(/^ic_/, '').slice(0, 6) + ')' : '')]));
}
function planOf(lib, reg) {
  const items = [];
  const inames = iconNames(lib.icons || []);
  for (const ic of lib.icons || []) {
    const sig = sigOfIcon(ic), ex = reg.get(ic.id);
    items.push({ kind: 'icon', id: ic.id, name: inames.get(ic.id), group: 'Icons', def: ic, sig, existing: ex || null, status: !ex ? 'create' : ex.getSharedPluginData(NS, 'sig') === sig ? 'exists' : 'changed' });
  }
  const { out, cyc } = orderComponents(lib.components || []);
  for (const d of out) {
    const sig = sigOfComponent(d), ex = reg.get(d.id);
    items.push({ kind: 'cmp', id: d.id, name: d.name, group: d.group || 'Other', def: d, sig, existing: ex || null, status: !ex ? 'create' : ex.getSharedPluginData(NS, 'sig') === sig ? 'exists' : 'changed' });
  }
  return { items, cyc };
}
const count = (items, k) => items.filter((i) => i.status === k).length;

// ---------- reports ----------
async function dsLines(lib) {
  const out = [];
  for (const d of lib.components || []) {
    if (!d.ds) continue;
    let found = '';
    if (d.ds.id) { try { const n = await figma.getNodeByIdAsync(d.ds.id); found = n ? ', id found in this file (' + n.type + ')' : ', id not found in this file'; } catch (e) { found = ', id lookup failed'; } }
    out.push('  ' + d.id + ' "' + d.name + '" ~ DS "' + d.ds.name + '" score ' + d.ds.score + ' mode ' + d.ds.mode + found + (d.ds.mode !== 'report' ? ' (mode ignored: report only)' : ''));
  }
  return out;
}
function reviewReport(lib, plan) {
  const rev = (lib.components || []).filter((c) => c.band === 'review').sort((a, b) => a.conf - b.conf);
  const st = new Map(plan.items.map((i) => [i.id, i.status]));
  const lines = ['REVIEW REPORT: ' + rev.length + ' review-band component(s) of ' + (lib.components || []).length];
  for (const c of rev) {
    lines.push('- ' + c.name + ' [' + c.id + '] group ' + c.group + ', conf ' + c.conf + ', nameSource ' + c.nameSource + ', seen ' + (c.stats ? c.stats.occ + 'x/' + c.stats.screens + ' screens' : '?') + ', in file: ' + (st.get(c.id) === 'exists' ? 'yes' : st.get(c.id) === 'changed' ? 'yes (library changed)' : 'no'));
    if (c.variants) lines.push('    variants: ' + Object.keys(c.variants.props).map((k) => k + ' = ' + c.variants.props[k].join('|')).join('; '));
    lines.push('    slots: ' + (c.slots.map((s) => s.kind + ':' + s.name).join(', ') || 'none'));
    for (const n of c.notes || []) lines.push('    note: ' + n);
  }
  return lines;
}
function summaryLines(label) {
  const r = S.r;
  const l = [label + ': created ' + S.created + ' (sets ' + S.sets + ', instances used ' + S.instances + '), already present ' + S.exists + ', superseded ' + S.superseded + ', metadata updated ' + S.metaUpdated + ', failed ' + S.failed + (S.cancelled ? ', not processed (cancelled) ' + S.cancelled : ''),
    'Ladder per item: R0 ' + r.R0 + ' | R1 ' + r.R1 + ' (step skipped) | R2 ' + r.R2 + ' (bounds fixed) | R3 ' + r.R3 + ' (plain fallback) | R4 ' + r.R4 + ' (failed)'];
  if (S.flags.length) l.push('First flags (' + S.flagged + ' total):\n  ' + S.flags.join('\n  '));
  if (S.errors.length) l.push('First errors:\n  ' + S.errors.join('\n  '));
  return l;
}

// ---------- run ----------
async function run(msg) {
  cancelled = false; ops = 0; S = newStats(); CUR = null;
  OPTS = Object.assign({ supersede: true, verifyLayout: true }, msg.opts || {});
  const mode = msg.mode === 'apply' ? 'apply' : msg.mode === 'review' ? 'review' : 'dry';
  APPLY = mode === 'apply';
  containers.clear(); fontCache.clear(); BUILT = new Map(); ICONS = new Map(); DEFS = new Map(); _liftRegCache = null;
  let lib;
  try { lib = typeof msg.library === 'string' ? JSON.parse(msg.library) : msg.library; } catch (e) { say('Invalid JSON: ' + e.message); figma.ui.postMessage({ finished: true }); return; }
  if (!lib || lib.version !== 1 || !Array.isArray(lib.components) || !Array.isArray(lib.icons)) { say('Not a _library.json (need version 1, components[], icons[]).'); figma.ui.postMessage({ finished: true }); return; }
  for (const d of lib.components) DEFS.set(d.id, d);
  const t0 = Date.now();
  const reg = await liftRegistry();
  const plan = planOf(lib, reg);
  const total = plan.items.length;
  const dsl = await dsLines(lib);
  const lines = [];
  const head = 'Library: ' + lib.components.length + ' components, ' + lib.icons.length + ' icons. In file: ' + reg.size + ' tagged master(s).';
  say(head);
  if (plan.cyc.length) say('Dependency cycle broken at: ' + plan.cyc.join(', ') + ' (nested instances there fall back to plain frames).');
  const sets = lib.components.filter((c) => c.variants).length;

  if (mode === 'review') {
    for (const l of reviewReport(lib, plan)) lines.push(l);
    if (dsl.length) { lines.push('Design-system matches (report only):'); lines.push(...dsl); }
    const rep = head + '\n' + lines.join('\n');
    say(lines.join('\n'));
    figma.ui.postMessage({ report: rep, finished: true });
    return;
  }

  const H = await getHost();
  if (mode === 'dry') {
    lines.push('DRY RUN (nothing is created). ' + H.note);
    lines.push('Icons: create ' + count(plan.items.filter((i) => i.kind === 'icon'), 'create') + ', exist ' + count(plan.items.filter((i) => i.kind === 'icon'), 'exists') + ', changed ' + count(plan.items.filter((i) => i.kind === 'icon'), 'changed'));
    const cs = plan.items.filter((i) => i.kind === 'cmp');
    lines.push('Components: create ' + count(cs, 'create') + ', exist ' + count(cs, 'exists') + ', changed ' + count(cs, 'changed') + ' (' + sets + ' with variants)');
    if (plan.cyc.length) lines.push('Dependency cycles: ' + plan.cyc.join(', '));
    const maxList = 300; let shown = 0;
    for (const i of plan.items) { if (i.status === 'exists') continue; if (shown++ >= maxList) { lines.push('  ... ' + (plan.items.filter((x) => x.status !== 'exists').length - maxList) + ' more'); break; } lines.push('  ' + i.status.toUpperCase() + ' ' + i.id + ' "' + i.name + '" in ' + i.group + (i.def.variants ? ' (set of ' + i.def.variants.members.length + ')' : '') + (i.status === 'changed' ? (OPTS.supersede ? ' -> new master, old renamed (superseded)' : ' -> left as is (supersede off)') : '')); }
    const review = lib.components.filter((c) => c.band === 'review').length;
    lines.push('Review-band components: ' + review + ' (run "Review report")');
    { // structured copy of the dry-run counts for UIs that render results (older UIs ignore it)
      const ic = plan.items.filter((i) => i.kind === 'icon');
      figma.ui.postMessage({ preview: { components: { create: count(cs, 'create'), exists: count(cs, 'exists'), changed: count(cs, 'changed') }, icons: { create: count(ic, 'create'), exists: count(ic, 'exists'), changed: count(ic, 'changed') }, sets, review, cycles: plan.cyc.slice(), supersede: !!OPTS.supersede, host: H.note, items: plan.items.filter((i) => i.status !== 'exists').slice(0, 300).map((i) => ({ status: i.status, kind: i.kind, id: i.id, name: i.name, group: i.group })) } });
    }
    if (dsl.length) { lines.push('Design-system matches (report only):'); lines.push(...dsl); }
    const rep = head + '\n' + lines.join('\n');
    say(lines.join('\n'));
    figma.ui.postMessage({ report: rep, finished: true });
    return;
  }

  // ---- apply ----
  say(H.note);
  try {
    const fonts = await figma.listAvailableFontsAsync();
    available = new Map();
    for (const f of fonts) { if (!available.has(f.fontName.family)) available.set(f.fontName.family, new Set()); available.get(f.fontName.family).add(f.fontName.style); }
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const need = new Map(); for (const d of lib.components) { collectFonts(d.root, need); if (d.variants) for (const m of d.variants.members) collectFonts(m.root, need); }
    for (const [fam, w] of need.values()) { if (!available.has(fam)) say('Font missing in Figma: ' + fam + ' (falls back to Inter)'); await fontFor(fam, w); }
  } catch (e) { err('fonts', e); }
  if (H.kind === 'page' && figma.currentPage !== H.page) { try { await figma.setCurrentPageAsync(H.page); } catch (e) { err('setCurrentPage', e); } }

  REG = new Map(reg);
  for (const i of plan.items) if (i.kind === 'icon' && i.existing && i.status === 'exists') ICONS.set(i.id, { comp: i.existing, def: i.def });
  const placed = new Map();
  let done = 0;
  for (const it of plan.items) {
    if (cancelled) { S.cancelled = total - done; say('Cancelled.'); break; }
    done++;
    figma.ui.postMessage({ progress: { done, total, item: it.id } });
    CUR = { rung: 0, flags: [], id: it.id };
    if (it.status === 'exists' || (it.status === 'changed' && !OPTS.supersede)) {
      S.exists++;
      if (it.kind === 'cmp' && it.existing) {
        const want = String(it.def.conf);
        if (it.existing.getSharedPluginData(NS, 'conf') !== want || it.existing.getSharedPluginData(NS, 'band') !== it.def.band) {
          safe('metadata', () => { it.existing.setSharedPluginData(NS, 'conf', want); it.existing.setSharedPluginData(NS, 'band', it.def.band); if (CFG.descriptionPersists) it.existing.description = describe(it.def); S.metaUpdated++; });
        }
      }
      continue;
    }
    let host = null, before = null;
    try {
      host = containerFor(H, it.group);
      before = new Set(host.children);
      let node;
      if (it.kind === 'icon') node = await makeIcon(it.def, it.name, host);
      else node = it.def.variants ? await makeSet(it.def, host) : await makeSingle(it.def, host);
      if (it.status === 'changed' && it.existing) { try { supersede(it.existing); } catch (e) { flag(1, 'supersede: ' + e.message); } }
      tag(node, it.id, it.sig, it.kind === 'cmp' ? { conf: it.def.conf, band: it.def.band, kind: it.def.variants ? 'set' : 'component', libsig: it.def.sig || '' } : { kind: 'icon' });
      if (it.kind === 'cmp' && CFG.descriptionPersists) safe('description', () => { node.description = describe(it.def); });
      REG.set(it.id, node);
      if (it.kind === 'icon') { ICONS.set(it.id, { comp: node, def: it.def }); S.iconsCreated++; }
      if (!placed.has(it.group)) placed.set(it.group, []);
      placed.get(it.group).push(node);
      if (it.status === 'changed') S.superseded++;
      S.created++;
    } catch (e) {
      S.failed++; CUR.rung = 4; err(it.id + ' ' + it.name, e);
      if (host && before) for (const ch of [...host.children]) if (!before.has(ch)) { try { ch.remove(); } catch (x) { /* ignore */ } }
    }
    S.r['R' + CUR.rung]++;
    await tick();
  }
  for (const [g, nodes] of placed) { const c = containers.get(g); if (c) safe('layout ' + g, () => layoutInto(c, nodes)); }
  if (H.kind === 'page') safe('viewport', () => figma.viewport.scrollAndZoomIntoView(H.host.children));
  lines.push('APPLY finished in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's. ' + H.note);
  lines.push(...summaryLines('Summary'));
  const rep = head + '\n' + lines.join('\n');
  say(lines.join('\n'));
  figma.ui.postMessage({ report: rep, progress: { done: total, total, item: 'done' }, finished: true });
  figma.ui.postMessage({ summary: S });
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'run') return;
  try { await run(msg); } catch (e) { say('Error: ' + (e && e.message ? e.message : e)); figma.ui.postMessage({ finished: true }); }
};
