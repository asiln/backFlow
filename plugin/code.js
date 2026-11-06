// Figma Lift Import: builds Figma layers from the JSON the extractor writes.
// Defensive by design: every node and every optional styling step is wrapped, so one bad node never aborts the import.
figma.showUI(__html__, { width: 380, height: 600 });

// ---------------------------------------------------------------------------------------------------------------------
// CFG: facts about the Figma runtime that could not be verified from the typings. Run plugin/verify (docs/VERIFY-IN-FIGMA.md)
// once in real Figma and paste the printed CFG block here. The defaults below are the best guess from the typings.
// ---------------------------------------------------------------------------------------------------------------------
const CFG = {
  autoLayout: true,           // master switch for everything driven by the JSON field `ls`
  strokeInLayout: true,       // V1: strokesIncludedInLayout = true makes children sit inside the stroke (like a CSS border)
  allowNegativeSpacing: false, // V2: itemSpacing < 0 accepted (not used by the extractor today, kept for future use)
  spaceAround: true,          // V3: primaryAxisAlignItems accepts SPACE_AROUND / SPACE_EVENLY (the extractor only emits them when asked)
  wrap: true,                 // V5: layoutWrap = 'WRAP' + counterAxisSpacing work
  grid: true,                 // V6: layoutMode = 'GRID' with gridColumnSizes / setGridChildPosition work
  gridAppendChildAt: false,   // V6: prefer grid.appendChildAt(child, row, col) over appendChild + setGridChildPosition
  fillTextWorks: true,        // V7: text with textAutoResize HEIGHT + layoutSizingHorizontal FILL gets a real width
  absoluteConstraints: true,  // V8: ABSOLUTE children keep constraints when the parent resizes
};
const say = (log) => figma.ui.postMessage({ log });
const tick = () => new Promise((r) => (typeof setTimeout === 'function' ? setTimeout(r, 0) : r()));

const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
let available = new Map(); // family -> Set(style)
const fontCache = new Map();
let OPTS = { bindVars: false, autoLayout: true };
let ASSETS = {};
let cancelled = false;

const stats = { frames: 0, text: 0, svg: 0, img: 0, autoLayout: 0, svgFail: 0, imgFail: 0, nodeFail: 0, styleFail: 0, bound: 0, rotated: 0, lv0: 0, lv1: 0, lv2: 0, lv3: 0, lvN: 0, degraded: 0, absKids: 0, textGuard: 0, wrapFix: 0 };
const failNotes = [];
const note = (what, e) => { if (failNotes.length < 12) failNotes.push(what + ': ' + (e && e.message ? e.message : e)); };
// run an optional styling step; never throws
const safe = (label, fn) => { try { return fn(); } catch (e) { stats.styleFail++; note(label, e); return undefined; } };

function pickStyle(family, weight) {
  const styles = available.get(family);
  const w = Math.round(weight / 100) * 100;
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

// ---------- colour variables ----------
let colorVars = null; // Map "r,g,b,a" -> Variable
const k8 = (c, a) => [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(a * 100) / 100].join(',');
async function loadColorVariables() {
  colorVars = null;
  try {
    const vars = await figma.variables.getLocalVariablesAsync('COLOR');
    if (!vars.length) { say('Bind colours: no local COLOR variables in this file, skipping.'); return; }
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const colById = new Map(cols.map((c) => [c.id, c]));
    const byId = new Map(vars.map((v) => [v.id, v]));
    const resolve = async (v, modeId, depth) => {
      let val = v.valuesByMode[modeId];
      if (val === undefined) val = Object.values(v.valuesByMode)[0];
      if (val && val.type === 'VARIABLE_ALIAS') {
        if (depth > 8) return null;
        const t = byId.get(val.id) || (await figma.variables.getVariableByIdAsync(val.id));
        if (!t) return null;
        const tc = colById.get(t.variableCollectionId);
        return resolve(t, tc ? tc.defaultModeId : Object.keys(t.valuesByMode)[0], depth + 1);
      }
      return val && typeof val.r === 'number' ? val : null;
    };
    const score = (v) => { const c = colById.get(v.variableCollectionId); const n = c ? c.name : ''; return /^colou?rs?$/i.test(n) ? 0 : /primitive/i.test(n) ? 2 : 1; };
    const map = new Map(), best = new Map();
    for (const v of vars) {
      const col = colById.get(v.variableCollectionId);
      const val = await resolve(v, col ? col.defaultModeId : Object.keys(v.valuesByMode)[0], 0);
      if (!val) continue;
      const key = k8(val, val.a === undefined ? 1 : val.a);
      const s = score(v);
      if (!map.has(key) || s < best.get(key)) { map.set(key, v); best.set(key, s); }
    }
    colorVars = map;
    say('Bind colours: ' + map.size + ' distinct colour values from ' + vars.length + ' variables.');
  } catch (e) { note('variables', e); say('Bind colours: could not read variables (' + (e && e.message ? e.message : e) + ')'); }
}
function solid(c) {
  let p = { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
  if (OPTS.bindVars && colorVars) {
    const v = colorVars.get(k8(c, c.a));
    if (v) {
      try { const b = figma.variables.setBoundVariableForPaint(p, 'color', v); if (b) { p = b; stats.bound++; if (c.a < 1) p = Object.assign({}, b, { opacity: 1 }); } }
      catch (e) { note('bind', e); }
    }
  }
  return p;
}

function inv(m) { // invert 2x3 affine [[a,b,tx],[c,d,ty]]
  const [[a, b, tx], [c, d, ty]] = m, det = a * d - b * c || 1e-9;
  return [[d / det, -b / det, (b * ty - d * tx) / det], [-c / det, a / det, (c * tx - a * ty) / det]];
}
function gradPaint(g, w, h) {
  const n = g.stops.length;
  const stops = g.stops.map((s, i) => ({ position: Math.min(1, Math.max(0, s.pos != null ? s.pos : i / (n - 1))), color: { r: s.c.r, g: s.c.g, b: s.c.b, a: s.c.a } }));
  if (g.type === 'radial') {
    const k = 1 / 1.414;
    return { type: 'GRADIENT_RADIAL', gradientStops: stops, gradientTransform: [[k, 0, 0.5 - 0.5 * k], [0, k, 0.5 - 0.5 * k]] };
  }
  const th = g.angle * Math.PI / 180, dx = Math.sin(th), dy = -Math.cos(th);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  const sx = 0.5 - (dx * L / 2) / w, sy = 0.5 - (dy * L / 2) / h;
  const ex = 0.5 + (dx * L / 2) / w, ey = 0.5 + (dy * L / 2) / h;
  const M = [[ex - sx, -dy * L / w, sx], [ey - sy, dx * L / h, sy]];
  return { type: 'GRADIENT_LINEAR', gradientStops: stops, gradientTransform: inv(M) };
}

// ---------- images ----------
const imageCache = new Map(); // asset id or data string -> hash
function imageHashOf(item) {
  const key = item.asset || null;
  if (key && imageCache.has(key)) return imageCache.get(key);
  const data = item.data || (item.asset && ASSETS[item.asset]);
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/.exec(data || '');
  if (!m) return null;
  const hash = figma.createImage(figma.base64Decode(m[2])).hash;
  if (key) imageCache.set(key, hash);
  return hash;
}
// mode: FILL | FIT | CROP (+tf) | TILE (+scale)
function imagePaint(item, mode) {
  let hash;
  try { hash = imageHashOf(item); } catch (e) { note('image', e); return null; }
  if (!hash) return null;
  mode = mode || 'FILL';
  if (mode === 'CROP' && item.tf) return { type: 'IMAGE', imageHash: hash, scaleMode: 'CROP', imageTransform: item.tf };
  if (mode === 'TILE') return { type: 'IMAGE', imageHash: hash, scaleMode: 'TILE', scalingFactor: item.scale || 1 };
  return { type: 'IMAGE', imageHash: hash, scaleMode: mode === 'FIT' ? 'FIT' : 'FILL' };
}

function buildFills(n, w, h) {
  const fills = [];
  if (n.fill) fills.push(solid(n.fill));
  if (n.layers) {
    for (const l of [...n.layers].reverse()) {
      if (l.k === 'grad') fills.push(gradPaint(l, w, h));
      else if (l.k === 'img') { const p = imagePaint(l, l.mode); if (p) fills.push(p); else stats.imgFail++; }
    }
  } else if (n.grads) for (const g of [...n.grads].reverse()) fills.push(gradPaint(g, w, h));
  return fills;
}

const BLEND = (b) => String(b).toUpperCase().replace(/-/g, '_');
// styling shared by frames and rectangles
function styleBox(f, n, isFrame) {
  const w = Math.max(n.w, 1), h = Math.max(n.h, 1);
  safe('fills', () => { f.fills = buildFills(n, w, h); });
  if (n.stroke) safe('stroke', () => {
    f.strokes = [solid(n.stroke.c)]; f.strokeAlign = 'INSIDE';
    const [t, r, b, l] = n.stroke.w;
    if (t === r && r === b && b === l) f.strokeWeight = t;
    else { f.strokeTopWeight = t; f.strokeRightWeight = r; f.strokeBottomWeight = b; f.strokeLeftWeight = l; }
    if (n.stroke.style === 'dashed') f.dashPattern = [6, 4];
    else if (n.stroke.style === 'dotted') f.dashPattern = [1, 3];
  });
  const rad = n.radiusArr || n.radius;
  if (rad) safe('radius', () => {
    if (Array.isArray(rad)) {
      const [tl, tr, br, bl] = rad;
      if (tl === tr && tr === br && br === bl) f.cornerRadius = tl;
      else { f.topLeftRadius = tl; f.topRightRadius = tr; f.bottomRightRadius = br; f.bottomLeftRadius = bl; }
    } else f.cornerRadius = rad;
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

// position, rotation/flip and fixed-position constraints
function place(node, n, parent) {
  safe('position', () => { node.x = n.x; node.y = n.y; });
  if (n.xf) safe('transform', () => {
    const [a, b, c, d, tx, ty] = n.xf;
    node.relativeTransform = [[a, c, tx], [b, d, ty]];
    stats.rotated++;
  });
  if (n.ls && n.ls.cn && CFG.autoLayout && OPTS.autoLayout !== false) safe('constraints', () => { if ('constraints' in node) node.constraints = { horizontal: n.ls.cn[0], vertical: n.ls.cn[1] }; });
  else if (n.pos === 'fixed' || n.pos === 'sticky') safe('constraints', () => {
    if (!('constraints' in node) || parent.type === 'PAGE' || (parent.layoutMode && parent.layoutMode !== 'NONE')) return;
    const pw = parent.width, ph = parent.height;
    node.constraints = {
      horizontal: n.x < 1 && Math.abs(n.x + n.w - pw) < 1 ? 'STRETCH' : n.x + n.w / 2 > pw * 0.66 ? 'MAX' : 'MIN',
      vertical: n.y + n.h > ph - 1 ? 'MAX' : 'MIN',
    };
  });
}

const alignOf = (f) => { const a = f.align; return a === 'center' ? 'CENTER' : (a === 'right' || (a === 'start' && f.dir === 'rtl') || (a === 'end' && f.dir !== 'rtl')) ? 'RIGHT' : 'LEFT'; };
const decoOf = (d) => (d && d.includes('underline') ? 'UNDERLINE' : d && d.includes('line-through') ? 'STRIKETHROUGH' : 'NONE');

let processed = 0, total = 1, curScreen = '';
async function bump() {
  processed++;
  if (processed % 40 === 0) { figma.ui.postMessage({ progress: { done: processed, total, screen: curScreen } }); await tick(); }
}

// ---------- auto-layout support (JSON field `ls`, see docs/AUTO-LAYOUT-SPEC.md and README) ----------
const DRIFT = new Map(); // node id -> {w,h}: how much text metrics of Figma differ from Chrome inside that subtree
const isAutoMode = (m) => m === 'HORIZONTAL' || m === 'VERTICAL' || m === 'GRID';
const isAutoParent = (p) => !!p && p.type === 'FRAME' && isAutoMode(p.layoutMode);
const layoutOn = () => CFG.autoLayout && OPTS.autoLayout !== false;
const wantsAuto = (n) => layoutOn() && n.t === 'frame' && n.ls && n.ls.k && n.ls.k !== 'N' && n.children && n.children.length && !(n.ls.k === 'G' && !CFG.grid) && !(n.ls.k === 'W' && !CFG.wrap);
const isAbsKid = (d) => !!(d && d.ls && d.ls.abs);

async function build(n, parent) {
  if (cancelled) return null;
  try { const r = await buildInner(n, parent); await bump(); return r; }
  catch (e) { stats.nodeFail++; note((n && n.name) || 'node', e); return null; }
}

// add a built node to its parent (grid parents place by cell)
function attach(parent, node, n) {
  if (parent.layoutMode === 'GRID' && n.ls && n.ls.gp && layoutOn()) {
    const [r, c] = n.ls.gp;
    try {
      if (CFG.gridAppendChildAt && parent.appendChildAt) { parent.appendChildAt(node, r, c); return; }
      parent.appendChild(node);
      if (node.gridRowAnchorIndex !== r || node.gridColumnAnchorIndex !== c) node.setGridChildPosition(r, c);
      return;
    } catch (e) { stats.styleFail++; note('grid place', e); if (!node.parent) parent.appendChild(node); return; }
  }
  parent.appendChild(node);
}
// out-of-flow child of an auto-layout parent
function makeAbsolute(node, n, parent) {
  safe('absolute', () => { node.layoutPositioning = 'ABSOLUTE'; });
  place(node, n, parent);
  stats.absKids++;
}
function postPlace(node, n, parent) {
  if (isAutoParent(parent) && n.ls && n.ls.abs && layoutOn()) makeAbsolute(node, n, parent);
  else if (isAutoParent(parent) && layoutOn() && n.ls && n.ls.s) return; // flow child: position comes from the parent
  else place(node, n, parent);
}

async function buildInner(n, parent) {
  const w = Math.max(n.w, 1), h = Math.max(n.h, 1);
  const L = layoutOn() ? n.ls : null;
  const managed = !!(L && L.s && !L.abs && isAutoParent(parent));
  if (n.t === 'text') {
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
    // mixed inline styling
    const len = t.characters.length;
    for (const r of n.runs || []) {
      const s = r.s, e = Math.min(r.e, len);
      if (!(e > s)) continue;
      try {
        if (r.family || r.weight) t.setRangeFontName(s, e, await fontFor(r.family || f.family, r.weight || f.weight));
        if (r.size) t.setRangeFontSize(s, e, Math.max(r.size, 1));
        if (r.color) t.setRangeFills(s, e, [solid(r.color)]);
        if (r.deco) t.setRangeTextDecoration(s, e, decoOf(r.deco));
      } catch (er) { stats.styleFail++; note('run', er); }
    }
    attach(parent, t, n);
    if (L && L.abs && isAutoParent(parent)) safe('absolute', () => { t.layoutPositioning = 'ABSOLUTE'; stats.absKids++; });
    if (!managed) {
      safe('textBox', () => {
        if (n.fixed) { t.textAutoResize = 'HEIGHT'; t.resize(w + 1, t.height); t.x = n.x; }
        else { t.textAutoResize = 'NONE'; t.resize(w + 2, h); t.x = n.x - 1; }
        t.y = n.y;
      });
      if (L && L.cn) safe('constraints', () => { t.constraints = { horizontal: L.cn[0], vertical: L.cn[1] }; });
    }
    t.name = (n.text.replace(/\s+/g, ' ').slice(0, 40)) || 'text';
    if (n.xf) place(t, Object.assign({}, n, { x: n.x, y: n.y }), parent);
    stats.text++;
    return t;
  }
  if (n.t === 'svg') {
    try {
      const s = figma.createNodeFromSvg(n.svg);
      s.name = n.name && n.name !== 'svg' ? n.name : 'icon';
      safe('svgSize', () => s.resize(w, h));
      attach(parent, s, n);
      postPlace(s, n, parent);
      if (n.opacity != null) safe('opacity', () => { s.opacity = n.opacity; });
      stats.svg++; return s;
    } catch (e) {
      stats.svgFail++; note('svg', e);
      const r = figma.createRectangle(); r.name = 'icon (svg failed)'; r.resize(w, h); r.fills = []; parent.appendChild(r); r.x = n.x; r.y = n.y; return r;
    }
  }
  if (n.t === 'img') {
    const asRect = !n.failed || (n.data || n.asset);
    let node;
    if (asRect) {
      node = figma.createRectangle(); node.name = n.alt ? 'image · ' + n.alt.slice(0, 30) : 'image'; node.resize(w, h);
      const m = Object.assign({}, n);
      const fills = [];
      if (n.fill) fills.push(solid(n.fill));
      const p = imagePaint(n, n.fit);
      if (p) fills.push(p); else { stats.imgFail++; fills.push({ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.3 }); node.name += ' (no image data)'; }
      attach(parent, node, n);
      styleBox(node, Object.assign({}, m, { fill: null, layers: null, grads: null }), false);
      safe('imgFills', () => { node.fills = fills; });
    } else {
      // labelled placeholder
      stats.imgFail++;
      node = figma.createFrame(); node.name = 'image (failed: ' + String(n.failed).slice(0, 40) + ')'; node.resize(w, h);
      node.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.3 }];
      attach(parent, node, n);
      styleBox(node, Object.assign({}, n, { fill: null }), true);
      safe('imgFills', () => { node.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.3 }]; });
      if (w >= 40 && h >= 16) {
        try {
          const t = figma.createText(); t.fontName = await fontFor('Inter', 400); t.characters = 'IMG: ' + (n.alt || 'failed').slice(0, 24); t.fontSize = Math.min(10, Math.max(7, h / 3));
          t.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } }]; node.appendChild(t); t.x = 2; t.y = 2;
        } catch (e) { /* label is optional */ }
      }
    }
    postPlace(node, n, parent);
    stats.img++; return node;
  }
  const f = figma.createFrame();
  f.name = n.name || 'frame';
  f.resize(w, h);
  styleBox(f, n, true);
  attach(parent, f, n);
  postPlace(f, n, parent);
  stats.frames++;
  let auto = wantsAuto(n);
  if (auto) { try { configureAuto(f, n, w, h); } catch (e) { auto = false; stats.styleFail++; note('autoLayout ' + (n.name || ''), e); safe('noLayout', () => { f.layoutMode = 'NONE'; }); stats.lv3++; stats.degraded++; } }
  const kids = [];
  for (const c of n.children || []) { const k = await build(c, f); if (k) kids.push({ k, d: c }); }
  if (auto) {
    try { finishAuto(f, n, kids, w, h); } catch (e) { stats.styleFail++; note('finishAuto ' + (n.name || ''), e); freezeToAbsolute(f, n, kids, w, h); stats.lv3++; stats.degraded++; }
  } else if (!n.ls && n.layout && kids.length && kids.length < 60 && !n.xf) safe('autoLayout', () => tryAutoLayout(f, n, kids)); // legacy JSON without `ls`
  else if (n.ls && n.children && n.children.length && n.ls.k === 'N') stats.lvN++;
  return f;
}

function configureAuto(f, n, w, h) {
  const L = n.ls;
  if (L.k === 'G') {
    f.layoutMode = 'GRID';
    f.gridColumnCount = L.cols.length; f.gridRowCount = L.rows.length;
    f.gridColumnGap = L.cg || 0; f.gridRowGap = L.rg || 0;
    L.cols.forEach((c, i) => { const t = f.gridColumnSizes[i]; t.type = c.t; if (c.t !== 'HUG' && c.v != null) t.value = c.v; });
    L.rows.forEach((r, i) => { const t = f.gridRowSizes[i]; t.type = r.t; if (r.t !== 'HUG' && r.v != null) t.value = r.v; });
  } else {
    f.layoutMode = L.k === 'V' ? 'VERTICAL' : 'HORIZONTAL';
    if (L.k === 'W') { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = L.g2 || 0; f.counterAxisAlignContent = 'AUTO'; }
    f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
    f.itemSpacing = Math.max(CFG.allowNegativeSpacing ? -1e6 : 0, L.g || 0);
    f.primaryAxisAlignItems = L.pa || 'MIN';
    f.counterAxisAlignItems = L.ca || 'MIN';
  }
  const bw = L.bw || [0, 0, 0, 0];
  const strokeIn = CFG.strokeInLayout && !!n.stroke;
  const p = (L.p || [0, 0, 0, 0]).map((v, i) => Math.max(0, v - (strokeIn ? bw[i] : 0)));
  f.paddingTop = p[0]; f.paddingRight = p[1]; f.paddingBottom = p[2]; f.paddingLeft = p[3];
  if (n.stroke) safe('strokesIncludedInLayout', () => { f.strokesIncludedInLayout = strokeIn; });
  f.resize(w, h); // resize last: it resets sizing modes to FIXED, which is what we want for now
}

function sizeText(k, d, s) {
  const tx = (d.ls && d.ls.tx) || {};
  safe('textSizing', () => {
    if (s[0] === 'H') { k.textAutoResize = 'WIDTH_AND_HEIGHT'; }
    else {
      k.textAutoResize = s[1] === 'F' ? 'NONE' : 'HEIGHT';
      k.resize(Math.max(d.w, 1), s[1] === 'F' ? Math.max(d.h, 1) : k.height);
      if (s[0] === 'L' && CFG.fillTextWorks) {
        k.layoutSizingHorizontal = 'FILL';
        if (k.width < 4) { k.layoutSizingHorizontal = 'FIXED'; k.resize(Math.max(d.w, 1), k.height); stats.textGuard++; }
      }
    }
    if (tx.tr) { k.textTruncation = 'ENDING'; k.maxLines = tx.tr; }
  });
}
function sizeFrameLike(k, d, s) {
  const canHug = (k.type === 'FRAME' || k.type === 'COMPONENT' || k.type === 'INSTANCE') && isAutoMode(k.layoutMode);
  const ax = (prop, v) => {
    if (v === 'L') safe(prop, () => { k[prop] = 'FILL'; });
    else if (v === 'H' && canHug) safe(prop, () => { k[prop] = 'HUG'; });
  };
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
  if (n.ls.k === 'G') for (const { k, d } of kids) if (d.ls && d.ls.gp && !d.ls.abs) safe('gridSpan', () => { if (d.ls.gp[2] > 1) k.gridRowSpan = d.ls.gp[2]; if (d.ls.gp[3] > 1) k.gridColumnSpan = d.ls.gp[3]; if (d.ls.ga) { k.gridChildHorizontalAlign = d.ls.ga[0]; k.gridChildVerticalAlign = d.ls.ga[1]; } });
  verifyNode(f, n, kids, w, h);
}

// ---------- verification + ladder ----------
// Compare what Figma produced with the rectangles Chrome measured. Text metrics differ a little between Chrome and Figma,
// so text size errors are tolerated (up to a plausibility limit) and added to a budget that loosens the checks of later siblings.
function evalDev(f, n, kids) {
  const bad = [];
  const horiz = n.ls.k === 'H' || n.ls.k === 'W';
  const flow = kids.filter(({ d, k }) => !isAbsKid(d) && !k.removed);
  // pass 1: size errors. Text errors are expected (different font metrics) and become a budget.
  const rows = flow.map(({ k, d }) => {
    const dr = DRIFT.get(k.id) || { w: 0, h: 0 };
    const dx = k.x - d.x, dy = k.y - d.y, dw = k.width - d.w, dh = k.height - d.h;
    const sp = d.ls && d.ls.sp;
    let ew = 0, eh = 0, sizeOk = true;
    if (k.type === 'TEXT') {
      const fillW = d.ls && d.ls.s && d.ls.s[0] === 'L' && !(d.ls.tx && d.ls.tx.bx);
      if (k.textAutoResize !== 'NONE') { ew = fillW ? 0 : Math.abs(dw); eh = Math.abs(dh); }
      if (ew > Math.max(6, 0.2 * d.w) || eh > Math.max(2.5, 0.5 * d.h)) sizeOk = false;
      return { k, d, dx, dy, dw, dh, ew, eh, sizeOk, fillW, sp };
    }
    if (!sp) { const hugSlack = d.ls && d.ls.s && d.ls.s.includes('H') ? Math.min(3, 0.4 * (d.children || []).length) : 0; if (Math.abs(dw) > 2 + dr.w + hugSlack || Math.abs(dh) > 2 + dr.h + hugSlack) sizeOk = false; ew = dr.w; eh = dr.h; }
    return { k, d, dx, dy, dw, dh, ew, eh, sizeOk, sp };
  });
  const totP = rows.reduce((a, r) => a + (horiz ? r.ew : r.eh), 0);
  const crossMax = rows.reduce((a, r) => Math.max(a, horiz ? r.eh : r.ew), 0);
  const minAlign = !n.ls.pa || n.ls.pa === 'MIN';
  let cum = 0, hugSeen = 0;
  for (const r of rows) {
    const budget = n.ls.k === 'W' || n.ls.k === 'G' ? rows.reduce((a, q) => a + q.ew + q.eh, 0) : (minAlign ? cum : totP);
    const tol = 2 + budget + crossMax * 0.5 + Math.min(2.5, 0.6 * hugSeen);
    if (r.d.ls && r.d.ls.s && r.d.ls.s.includes('H')) hugSeen++;
    let ok = r.sizeOk;
    if (r.sp) ok = horiz ? Math.abs(r.dx) <= tol && Math.abs(r.dw) <= 2 : Math.abs(r.dy) <= tol && Math.abs(r.dh) <= 2;
    else {
      if (Math.abs(r.dy) > tol) ok = false;
      if (!r.fillW && Math.abs(r.dx) > tol + (horiz ? 0 : 0)) ok = false;
    }
    if (!ok) bad.push(r);
    cum += horiz ? r.ew : r.eh;
  }
  return { ok: !bad.length, bad, sumW: rows.reduce((a, r) => a + r.ew, 0), sumH: rows.reduce((a, r) => a + r.eh, 0) };
}

function degradeFixed(f, n, kids) {
  for (const { k, d } of kids) {
    if (isAbsKid(d) || (d.ls && d.ls.sp)) continue;
    safe('fixKid', () => {
      if (k.type === 'TEXT') { const multi = d.ls && d.ls.tx && d.ls.tx.l > 1; k.textAutoResize = multi ? 'HEIGHT' : 'NONE'; k.resize(Math.max(d.w, 1), multi ? k.height : Math.max(d.h, 1)); }
      else k.resize(Math.max(d.w, 1), Math.max(d.h, 1));
    });
  }
}
function freezeToAbsolute(f, n, kids, w, h) {
  safe('freeze', () => { f.layoutMode = 'NONE'; });
  safe('freezeSize', () => f.resize(w, h));
  for (const { k, d } of kids) {
    if (d.ls && d.ls.sp) { safe('rmSpacer', () => { k.remove(); k.removed = true; }); continue; }
    safe('freezeKid', () => {
      if (k.type === 'TEXT') { const multi = d.ls && d.ls.tx && d.ls.tx.l > 1; k.textAutoResize = multi ? 'HEIGHT' : 'NONE'; k.resize(Math.max(d.w, 1), multi ? k.height : Math.max(d.h, 1)); }
      else k.resize(Math.max(d.w, 1), Math.max(d.h, 1));
      k.x = d.x; k.y = d.y;
    });
  }
}
// A one-line source text that wrapped in Figma (font metrics a little wider than Chrome) is switched to hug its content instead.
function fixWraps(kids) {
  for (const { k, d } of kids) {
    if (k.type !== 'TEXT' || !d.ls || !d.ls.tx || d.ls.tx.l !== 1 || d.ls.tx.tr || isAbsKid(d)) continue;
    if (k.textAutoResize === 'HEIGHT' && k.height > d.h * 1.5) safe('fixWrap', () => { k.textAutoResize = 'WIDTH_AND_HEIGHT'; stats.wrapFix++; });
  }
}
function verifyNode(f, n, kids, w, h) {
  let lv = n.ls.lv || 0;
  fixWraps(kids);
  const planned = lv;
  let dev = evalDev(f, n, kids);
  const dev0 = dev.ok ? '' : dev.bad.slice(0, 2).map((b) => `${(b.d && b.d.t) || b.k.type}${b.d && b.d.t === 'text' ? ' "' + String(b.d.text).slice(0, 12) + '"' : ''} dx${Math.round(b.dx)} dy${Math.round(b.dy)} dw${Math.round(b.dw)} dh${Math.round(b.dh)}`).join('; ');
  if (!dev.ok && lv < 1) { degradeFixed(f, n, kids); lv = 1; dev = evalDev(f, n, kids); }
  if (!dev.ok && lv < 2) {
    const off = dev.bad.filter((b) => !(b.d.ls && b.d.ls.sp));
    if (off.length && off.length <= Math.max(2, kids.length * 0.34)) {
      for (const b of off) safe('offender', () => { b.k.layoutPositioning = 'ABSOLUTE'; b.k.x = b.d.x; b.k.y = b.d.y; });
      lv = 2; dev = evalDev(f, n, kids);
    }
  }
  if (!dev.ok) { freezeToAbsolute(f, n, kids, w, h); lv = 3; }
  if (lv > planned && noteVerify.length < 8) noteVerify.push((n.name || 'frame') + ' -> F' + lv + (dev0 ? ': ' + dev0 : ''));
  stats['lv' + lv]++;
  if (lv > planned) stats.degraded++;
  DRIFT.set(f.id, { w: dev.sumW + kids.reduce((a, { k }) => a + ((DRIFT.get(k.id) || {}).w || 0), 0), h: dev.sumH + kids.reduce((a, { k }) => a + ((DRIFT.get(k.id) || {}).h || 0), 0) });
}
const noteVerify = [];

// Legacy: JSON produced before `ls` existed. Apply auto-layout only if it reproduces the original positions.
function tryAutoLayout(f, n, kidPairs) {
  if (kidPairs.some((p) => p.d.xf || p.d.pos || p.d.z != null || p.d.blend)) return false;
  const kids = kidPairs.map((p) => p.k);
  const horiz = n.layout.dir === 'H';
  const orig = kids.map((k) => ({ k, x: k.x, y: k.y }));
  const ordered = [...orig].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
  const [pt, pr, pb, pl] = n.layout.pad;
  const prim = ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'], counter = ['MIN', 'CENTER', 'MAX'];
  const w0 = f.width, h0 = f.height;
  for (const o of ordered) f.appendChild(o.k);
  f.layoutMode = horiz ? 'HORIZONTAL' : 'VERTICAL';
  f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
  f.itemSpacing = n.layout.gap;
  f.paddingTop = pt; f.paddingRight = pr; f.paddingBottom = pb; f.paddingLeft = pl;
  for (const p of prim) for (const c of counter) {
    f.primaryAxisAlignItems = p; f.counterAxisAlignItems = c;
    if (Math.abs(f.width - w0) > 0.5 || Math.abs(f.height - h0) > 0.5) f.resize(w0, h0);
    if (orig.every((o) => Math.abs(o.k.x - o.x) < 1.5 && Math.abs(o.k.y - o.y) < 1.5)) { stats.autoLayout++; return true; }
  }
  f.layoutMode = 'NONE';
  for (const o of orig) { f.appendChild(o.k); o.k.x = o.x; o.k.y = o.y; }
  return false;
}

const countNodes = (n) => 1 + (n.children || []).reduce((a, k) => a + countNodes(k), 0);

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'build') return;
  cancelled = false; processed = 0;
  for (const k of Object.keys(stats)) stats[k] = 0;
  failNotes.length = 0; imageCache.clear(); fontCache.clear();
  OPTS = Object.assign({ bindVars: false, autoLayout: true }, msg.opts || {});
  DRIFT.clear(); noteVerify.length = 0;
  ASSETS = msg.data.assets || {};
  const frames = msg.data.frames || [];
  total = frames.reduce((a, f) => a + countNodes(f), 0) || 1;
  const t0 = Date.now();
  try {
    const fonts = await figma.listAvailableFontsAsync();
    available = new Map();
    for (const f of fonts) { if (!available.has(f.fontName.family)) available.set(f.fontName.family, new Set()); available.get(f.fontName.family).add(f.fontName.style); }
    for (const fam of ['Vazirmatn', 'Space Grotesk', 'JetBrains Mono']) if (!available.has(fam)) say('Font missing in Figma: ' + fam + ' (falls back to Inter)');
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    if (OPTS.bindVars) await loadColorVariables();

    // one named section per import, placed right of existing content
    const page = figma.currentPage;
    let left = 0;
    for (const c of page.children) left = Math.max(left, c.x + c.width);
    const section = figma.createSection();
    section.name = (OPTS.sectionName || msg.data.name || 'Figma Lift import').slice(0, 80);
    section.x = left ? left + 200 : 0; section.y = 0;
    const PAD = 80, GAP = 80, ROW_MAX = 6000;
    let cx = PAD, cy = PAD + 40, rowH = 0, maxRight = 0;
    const created = [];
    let idx = 0;
    for (const fr of frames) {
      idx++;
      if (cancelled) { say('Cancelled.'); break; }
      curScreen = fr.name || ('screen ' + idx);
      say('[' + idx + '/' + frames.length + '] ' + curScreen);
      let node = null;
      const before = { lv0: stats.lv0, lv1: stats.lv1, lv2: stats.lv2, lv3: stats.lv3, deg: stats.degraded };
      try { node = await build(fr, page); } catch (e) { stats.nodeFail++; note(curScreen, e); }
      { const a = stats.lv0 - before.lv0, b = stats.lv1 - before.lv1, c = stats.lv2 - before.lv2, d = stats.lv3 - before.lv3, t = a + b + c + d;
        if (t) say('    auto-layout containers ' + t + ': F0 ' + a + ', F1 ' + b + ', F2 ' + c + ', F3 ' + d + (stats.degraded - before.deg ? ' (degraded in Figma: ' + (stats.degraded - before.deg) + ')' : '')); }
      if (!node) { say('  failed to build ' + curScreen); continue; }
      safe('frameName', () => { node.name = fr.name || node.name; });
      if (cx > PAD && cx + fr.w > ROW_MAX) { cx = PAD; cy += rowH + GAP; rowH = 0; }
      safe('sectionAppend', () => { section.appendChild(node); node.x = cx; node.y = cy; });
      cx += fr.w + GAP; rowH = Math.max(rowH, fr.h); maxRight = Math.max(maxRight, cx - GAP);
      created.push(node);
      figma.ui.postMessage({ progress: { done: processed, total, screen: curScreen } });
      await tick();
    }
    safe('sectionSize', () => section.resizeWithoutConstraints(Math.max(200, maxRight + PAD), Math.max(200, cy + rowH + PAD)));
    safe('select', () => { figma.currentPage.selection = [section]; figma.viewport.scrollAndZoomIntoView([section]); });
    const s = stats;
    say('Done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's. Screens ' + created.length + '/' + frames.length + ' | frames ' + s.frames + ', text ' + s.text + ', icons ' + s.svg + ', images ' + s.img + ', auto-layout F0 ' + s.lv0 + ' / F1 ' + s.lv1 + ' / F2 ' + s.lv2 + ' / F3 ' + s.lv3 + ' (degraded in Figma ' + s.degraded + ', absolute children ' + s.absKids + ', text-width guard ' + s.textGuard + ', wrap fixes ' + s.wrapFix + (s.autoLayout ? ', legacy auto-layout ' + s.autoLayout : '') + '), rotated ' + s.rotated + (OPTS.bindVars ? ', colours bound ' + s.bound : ''));
    if (noteVerify.length) say('Degraded containers (first ' + noteVerify.length + '): ' + noteVerify.join(' | '));
    const bad = s.svgFail + s.imgFail + s.nodeFail + s.styleFail;
    say(bad ? 'FAILURES: svg ' + s.svgFail + ', image placeholders ' + s.imgFail + ', nodes ' + s.nodeFail + ', style steps ' + s.styleFail + (failNotes.length ? '\n  ' + failNotes.join('\n  ') : '') : 'No failures.');
    figma.ui.postMessage({ progress: { done: total, total, screen: 'done' }, finished: true });
  } catch (e) { say('Error: ' + (e && e.message ? e.message : e)); figma.ui.postMessage({ finished: true }); }
};
