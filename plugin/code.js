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
let OPTS = { bindVars: false, autoLayout: true, useComponents: false, bindTokens: false };
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

// =====================================================================================================================
// Design system layer (optional): token binding by key (`tok`) and component instances (`cmp`).
// Everything here is inert unless OPTS.bindTokens / OPTS.useComponents are on AND the JSON carries the fields.
// Conventions (docs/COMPONENTS-AND-DESIGN-SYSTEM-SPEC.md 2.1, 4.6): masters carry sharedPluginData('figmalift','cmp',id) and optionally
// ('figmalift','slots', JSON of the _library slots); variables/styles carry ('figmalift','tokenKey',key) and ('figmalift','tokenRole',role).
// =====================================================================================================================
const NS = 'figmalift';
const ds = { inst: 0, r0: 0, r1: 0, detached: 0, plain: 0, missing: 0, ovApplied: 0, ovFail: 0, icons: 0, tokBound: 0, tokMiss: 0, fixFill: 0, fuzzyVariant: 0, rejected: 0 };
let TOKV = null;     // key -> [{ v, role, scopes }] (tagged variables)
let FLOATV = null;   // number -> [{ v, scopes }] (any FLOAT variable, value fallback)
let VARNAME = null;  // name or collection/name -> Variable (tokens.json name fallback)
let TOKS = null;     // { text, effect, paint }: key -> style
let TOKSTYLES = null; // untagged text styles for the value fallback
let TOKFILE = null;  // optional tokens.json
let LIB = null;      // optional _library.json (slot tables when masters carry no 'slots' data)
let REG = null;      // cmp id -> { id, node, kind: 'SET'|'COMP', name, vcache, slots }
let instTick = 0;

const ROLE_SCOPES = { fill: ['FRAME_FILL', 'SHAPE_FILL', 'ALL_FILLS'], stroke: ['STROKE_COLOR'], text: ['TEXT_FILL', 'ALL_FILLS'], icon: ['SHAPE_FILL', 'STROKE_COLOR'] };
const getShared = (o, k) => { try { return o.getSharedPluginData(NS, k) || ''; } catch (e) { return ''; } };
const scopesOf = (v) => { try { return v.scopes || []; } catch (e) { return []; } };
const scopeOk = (sc, want) => !sc.length || sc.includes('ALL_SCOPES') || want.some((w) => sc.includes(w));

async function varValue(v, byId, colById, depth) {
  const col = colById.get(v.variableCollectionId);
  let val = v.valuesByMode[col ? col.defaultModeId : Object.keys(v.valuesByMode)[0]];
  if (val === undefined) val = Object.values(v.valuesByMode)[0];
  if (val && val.type === 'VARIABLE_ALIAS') {
    if (depth > 8) return undefined;
    const t = byId.get(val.id) || (await figma.variables.getVariableByIdAsync(val.id));
    return t ? varValue(t, byId, colById, depth + 1) : undefined;
  }
  return val;
}
async function loadTokenRegistry() {
  TOKV = new Map(); FLOATV = new Map(); VARNAME = new Map(); TOKS = { text: new Map(), effect: new Map(), paint: new Map() }; TOKSTYLES = [];
  let nTag = 0;
  try {
    const vars = await figma.variables.getLocalVariablesAsync();
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const colById = new Map(cols.map((c) => [c.id, c]));
    const byId = new Map(vars.map((v) => [v.id, v]));
    for (const v of vars) {
      const col = colById.get(v.variableCollectionId);
      VARNAME.set(v.name, v); if (col) VARNAME.set(col.name + '/' + v.name, v);
      const key = getShared(v, 'tokenKey');
      if (key) { if (!TOKV.has(key)) TOKV.set(key, []); TOKV.get(key).push({ v, role: getShared(v, 'tokenRole'), scopes: scopesOf(v) }); nTag++; }
      if (v.resolvedType === 'FLOAT') {
        const val = await varValue(v, byId, colById, 0);
        if (typeof val === 'number') { numOf.set(v.id, val); if (!FLOATV.has(val)) FLOATV.set(val, []); FLOATV.get(val).push({ v, scopes: scopesOf(v) }); }
      }
    }
    for (const [list, map, kind] of [['getLocalTextStylesAsync', TOKS.text, 'text'], ['getLocalEffectStylesAsync', TOKS.effect, 'effect'], ['getLocalPaintStylesAsync', TOKS.paint, 'paint']]) {
      try {
        for (const s of await figma[list]()) { const k = getShared(s, 'tokenKey'); if (k) { map.set(k, s); nTag++; } else if (kind === 'text') TOKSTYLES.push(s); }
      } catch (e) { note('styles', e); }
    }
    say('Bind tokens: ' + nTag + ' tagged variables/styles, ' + FLOATV.size + ' distinct number values.');
  } catch (e) { note('tokens', e); say('Bind tokens: could not read variables (' + (e && e.message ? e.message : e) + ')'); }
}
const numOf = new Map(); // variable id -> resolved number
function parseColourKey(key) {
  const m = /^c:([0-9a-f]{6})@(\d+)$/.exec(key || ''); if (!m) return null;
  const h = m[1]; return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: Number(m[2]) / 100 };
}
const colourKeyOf = (c) => 'c:' + [c.r, c.g, c.b].map((x) => ('0' + Math.round(x * 255).toString(16)).slice(-2)).join('') + '@' + Math.round((c.a == null ? 1 : c.a) * 100);
function tokColourVar(key, role) {
  if (!key || !TOKV) return null;
  const cands = TOKV.get(key);
  if (cands && cands.length) {
    const want = ROLE_SCOPES[role] || [];
    const hit = cands.find((x) => x.role === role) || cands.find((x) => scopeOk(x.scopes, want)) || cands[0];
    return hit.v;
  }
  if (TOKFILE && TOKFILE.colors) { // name fallback through tokens.json target
    const e = TOKFILE.colors.find((x) => x.key === key && (!role || x.role === role)) || TOKFILE.colors.find((x) => x.key === key);
    if (e && e.target) { const v = VARNAME.get(e.target.collection + '/' + e.target.name) || VARNAME.get(e.target.name); if (v) return v; }
  }
  const p = parseColourKey(key);
  if (p && colorVars) return colorVars.get(k8(p, p.a)) || null; // value fallback (same map as the "Bind colours" option)
  return null;
}
function tokFloatVar(key, value) {
  if (!key || !TOKV) return null;
  const okv = (v) => value == null || !numOf.has(v.id) || Math.abs(numOf.get(v.id) - value) < 0.01;
  const cands = TOKV.get(key);
  if (cands) { const h = cands.find((x) => okv(x.v)); if (h) return h.v; }
  if (TOKFILE) {
    for (const fam of ['spacing', 'radii', 'sizes']) {
      const e = (TOKFILE[fam] || []).find((x) => x.key === key);
      if (e && e.target) { const v = VARNAME.get(e.target.collection + '/' + e.target.name) || VARNAME.get(e.target.name); if (v && okv(v)) return v; }
    }
  }
  if (value != null) { const l = FLOATV.get(value); if (l && l.length) { const h = l.find((x) => scopeOk(x.scopes, ['GAP', 'CORNER_RADIUS', 'WIDTH_HEIGHT'])) || l[0]; return h.v; } }
  return null;
}
function boundPaint(c, v) {
  const b = figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }, 'color', v);
  return c.a < 1 ? Object.assign({}, b, { opacity: 1 }) : b;
}
// solid paint, bound by token key when possible; otherwise exactly the legacy solid()
function paintFor(c, key, role) {
  if (OPTS.bindTokens && key && TOKV) {
    const v = tokColourVar(key, role);
    if (v) { try { const p = boundPaint(c, v); ds.tokBound++; return p; } catch (e) { note('tokbind', e); } }
    ds.tokMiss++;
  }
  return solid(c);
}
function bindGradientStops(stops, g, gr) {
  const over = {}; for (const e of gr || []) if (e && /^c:/.test(e.key)) over[e.i] = e.key;
  stops.forEach((s, i) => {
    try {
      const v = tokColourVar(over[i] || colourKeyOf(s.color), 'fill'); if (!v) return;
      s.boundVariables = { color: figma.variables.createVariableAlias(v) }; ds.tokBound++; // E12: literal form, setBoundVariableForPaint rejects gradients
    } catch (e) { note('gradStop', e); }
  });
}
const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'LINE', 'STAR', 'POLYGON']);
function vectorsOf(node, out, depth) {
  out = out || []; depth = depth || 0;
  if (VECTORISH.has(node.type)) out.push(node);
  if (depth < 5 && node.children) for (const c of node.children) vectorsOf(c, out, depth + 1);
  return out;
}
// colour every vector paint of an icon with a token variable, or (literal) with a plain colour
function recolourVectors(node, key, role, literal) {
  const v = key ? tokColourVar(key, role) : null;
  const pc = key ? parseColourKey(key) : null;
  if (key && !v) ds.tokMiss++;
  for (const vec of vectorsOf(node)) {
    for (const prop of ['strokes', 'fills']) {
      const ps = vec[prop]; if (!ps || !ps.length) continue;
      vec[prop] = ps.map((p) => {
        if (p.type !== 'SOLID') return p;
        if (v) { try { const b = figma.variables.setBoundVariableForPaint(p, 'color', v); ds.tokBound++; return pc && pc.a < 1 ? Object.assign({}, b, { opacity: 1 }) : b; } catch (e) { note('iconbind', e); } }
        if (literal) return { type: 'SOLID', color: { r: literal.r, g: literal.g, b: literal.b }, opacity: literal.a };
        return p;
      });
    }
  }
}
async function bindTextStyle(t, key, f) {
  try {
    let st = TOKS.text.get(key);
    if (!st) { // value fallback: t:family/size/weight/lh/ls_em
      const m = /^t:(.+)\/([0-9.]+)\/(\d+)\/([0-9.]+)\/(-?[0-9.]+)$/.exec(key);
      if (m) {
        const fam = m[1], size = Number(m[2]), lh = Number(m[4]), ls = Number(m[5]) * 100, sty = WEIGHT_NAMES[Math.round(Number(m[3]) / 100) * 100];
        st = TOKSTYLES.find((s) => s.fontName.family === fam && s.fontName.style === sty && Math.abs(s.fontSize - size) < 0.01 && s.lineHeight && s.lineHeight.unit === 'PIXELS' && Math.abs(s.lineHeight.value - lh) < 0.01 && Math.abs(((s.letterSpacing && s.letterSpacing.unit === 'PERCENT') ? s.letterSpacing.value : 0) - ls) < 0.2);
      }
    }
    if (!st) { ds.tokMiss++; return; }
    try { await figma.loadFontAsync(st.fontName); } catch (e) { /* style font missing: setTextStyleIdAsync reports it */ }
    await t.setTextStyleIdAsync(st.id); ds.tokBound++;
  } catch (e) { stats.styleFail++; note('textStyle', e); }
}
function bindNum(node, field, key, value) {
  const v = tokFloatVar(key, value);
  if (!v) { ds.tokMiss++; return; }
  node.setBoundVariable(field, v); ds.tokBound++;
}
function bindLayoutTok(f, n, p) {
  const t = n.tok, L = n.ls;
  if (t.g) bindNum(f, 'itemSpacing', t.g, L.g || 0);
  if (t.g2 && L.k === 'W') bindNum(f, 'counterAxisSpacing', t.g2, L.g2 || 0);
  if (t.p) ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach((fld, i) => { if (t.p[i]) bindNum(f, fld, t.p[i], p[i]); });
}
async function bindFrameTok(f, n) {
  const t = n.tok;
  const rad = n.radiusArr || n.radius;
  if (t.r && rad) safe('bindRadius', () => {
    const arr = Array.isArray(rad) ? rad : [rad, rad, rad, rad];
    const fields = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'];
    fields.forEach((fld, i) => { if (arr[i] > 0) bindNum(f, fld, /^r:[0-9.]+$/.test(t.r) ? t.r : 'r:' + arr[i], arr[i]); });
  });
  if (t.sw && n.stroke) safe('bindStroke', () => { const w = n.stroke.w; if (w[0] === w[1] && w[1] === w[2] && w[2] === w[3]) bindNum(f, 'strokeWeight', t.sw, w[0]); });
  if (t.e) {
    const st = TOKS.effect.get(t.e);
    if (!st) ds.tokMiss++;
    else { try { await f.setEffectStyleIdAsync(st.id); ds.tokBound++; } catch (e) { stats.styleFail++; note('effectStyle', e); } }
  }
}

// ---------- components ----------
async function loadComponentRegistry() {
  REG = new Map();
  try {
    if (figma.loadAllPagesAsync) await figma.loadAllPagesAsync();
    const pages = figma.root && figma.root.children ? figma.root.children : [figma.currentPage];
    for (const pg of pages) {
      let found = [];
      try { found = pg.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'], sharedPluginData: { namespace: NS, keys: ['cmp'] } }); } catch (e) { note('registry', e); }
      for (const nd of found) {
        const id = getShared(nd, 'cmp'); if (!id) continue;
        const old = REG.get(id);
        if (old && !/superseded/i.test(old.node.name)) continue;
        REG.set(id, { id, node: nd, kind: nd.type === 'COMPONENT_SET' ? 'SET' : 'COMP', name: nd.name, vcache: new Map(), slots: undefined });
      }
    }
    say('Use components: ' + REG.size + ' masters found in this file.');
  } catch (e) { note('registry', e); say('Use components: registry unavailable (' + (e && e.message ? e.message : e) + ')'); }
}
function slotsOf(entry) {
  if (entry.slots !== undefined) return entry.slots;
  let s = null;
  const raw = getShared(entry.node, 'slots');
  if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } }
  if (!s && LIB) { const c = (LIB.components || []).find((x) => x.id === entry.id); if (c) s = c.slots; }
  return (entry.slots = s);
}
const parseVariantName = (nm) => { const o = {}; String(nm).split(',').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; };
function pickVariant(entry, v, size) {
  if (entry.kind !== 'SET') return entry.node;
  const kids = (entry.node.children || []).filter((k) => k.type === 'COMPONENT');
  if (!kids.length) return null;
  const ck = JSON.stringify(v || {}) + '|' + (size || '');
  if (entry.vcache.has(ck)) return entry.vcache.get(ck);
  let best = null, bestScore = -1, exact = false;
  const keys = Object.keys(v || {});
  for (const k of kids) {
    const pr = parseVariantName(k.name);
    let sc = keys.filter((q) => pr[q] === v[q]).length;
    if (size && pr.Size) sc += 0.5 - Math.min(0.49, Math.abs(Number(pr.Size) - size) / 100); // icon size variants: nearest
    if (sc > bestScore) { best = k; bestScore = sc; exact = keys.every((q) => pr[q] === v[q]); }
  }
  if (!exact && keys.length) ds.fuzzyVariant++; // a hole in the variant matrix (E5): closest member, the verify step decides
  entry.vcache.set(ck, best);
  return best;
}
const at = (inst, path) => { let c = inst; for (const i of path || []) { c = c.children && c.children[i]; if (!c) throw new Error('slot path ' + JSON.stringify(path) + ' not found'); } return c; };
function propKey(inst, slot, type) {
  const cp = inst.componentProperties || {}; const want = slot.prop || slot.name;
  for (const k of Object.keys(cp)) if (cp[k].type === type && (k === want || k.split('#')[0] === want)) return k;
  return null;
}
async function mainOf(inst) { return inst.getMainComponentAsync ? inst.getMainComponentAsync() : inst.mainComponent; }
async function resolveSlot(inst, entry, sid, src) {
  const parts = String(sid).split('.');
  let cur = inst, curEntry = entry, curSrc = src;
  for (let i = 0; i < parts.length; i++) {
    const slots = slotsOf(curEntry); if (!slots) throw new Error('no slot table for ' + curEntry.id);
    const slot = slots.find((x) => x.s === parts[i]) || slots[Number(parts[i])]; if (!slot) throw new Error('slot ' + parts[i] + ' unknown in ' + curEntry.id);
    if (i === parts.length - 1) return { inst: cur, slot, node: at(cur, slot.path) };
    if (slot.kind !== 'inst') throw new Error('slot ' + parts[i] + ' is not a nested instance');
    const nested = at(cur, slot.path);
    let sNode = curSrc; try { for (const k of slot.path) sNode = sNode && sNode.children && sNode.children[k]; } catch (e) { sNode = null; }
    let id = sNode && sNode.cmp && sNode.cmp.id;
    if (!id) { const m = await mainOf(nested); const h = m && m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent : m; id = h && getShared(h, 'cmp'); }
    const ne = id && REG.get(id); if (!ne) throw new Error('nested master ' + id + ' not in registry');
    cur = nested; curEntry = ne; curSrc = sNode;
  }
}
async function loadNodeFonts(node) {
  try { if (node.fontName && node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName); else if (node.getRangeAllFontNames) for (const fn of node.getRangeAllFontNames(0, node.characters.length)) await figma.loadFontAsync(fn); } catch (e) { note('font', e); }
}
async function reapplyRuns(t, runs) {
  const len = t.characters.length;
  const fam = t.fontName && t.fontName !== figma.mixed ? t.fontName.family : 'Inter';
  for (const r of runs) {
    const s = r.s, e = Math.min(r.e, len); if (!(e > s)) continue;
    try {
      if (r.family || r.weight) t.setRangeFontName(s, e, await fontFor(r.family || fam, r.weight || 400));
      if (r.size) t.setRangeFontSize(s, e, Math.max(r.size, 1));
      if (r.color) t.setRangeFills(s, e, [solid(r.color)]);
      if (r.deco) t.setRangeTextDecoration(s, e, decoOf(r.deco));
    } catch (er) { stats.styleFail++; note('run', er); }
  }
}
async function applyOne(inst, entry, o, n) {
  const r = await resolveSlot(inst, entry, o.s, n);
  const tgt = r.inst, slot = r.slot, node = r.node;
  if ('t' in o) {
    if (!node || node.type !== 'TEXT') throw new Error('slot ' + o.s + ' is not text');
    await loadNodeFonts(node);
    const key = o.r && o.r.length ? null : propKey(tgt, slot, 'TEXT');
    if (key) tgt.setProperties({ [key]: o.t }); else node.characters = o.t; // runs: direct override, then re-apply the ranges
    if (o.r && o.r.length) await reapplyRuns(node, o.r);
  } else if ('b' in o) {
    const key = propKey(tgt, slot, 'BOOLEAN');
    if (key) tgt.setProperties({ [key]: o.b }); else node.visible = o.b;
  } else if ('ic' in o) {
    const ie = REG.get(o.ic); if (!ie) throw new Error('icon master ' + o.ic + ' missing');
    const key = propKey(tgt, slot, 'INSTANCE_SWAP'); if (!key) throw new Error('no INSTANCE_SWAP property for slot ' + o.s);
    const main = pickVariant(ie, null, o.sz);
    tgt.setProperties({ [key]: main.id });
    const sw = at(tgt, slot.path);
    if (o.sz) { sw.resize(o.sz, o.sz); fixIconStroke(sw, null, o.sz); }
    if (o.c) recolourVectors(sw, o.c, 'icon');
  } else if ('img' in o) {
    const p = imagePaint(o.img, o.img.fit); if (!p) throw new Error('image data missing');
    node.fills = [p];
  } else if ('v' in o) {
    node.setProperties(o.v);
  } else {
    if (o.fillTok || o.fill) node.fills = [o.fillTok ? paintFor(o.fill || parseColourKey(o.fillTok), o.fillTok, 'fill') : solid(o.fill)];
    if (o.strokeTok || o.stroke) node.strokes = [o.strokeTok ? paintFor(o.stroke || parseColourKey(o.strokeTok), o.strokeTok, 'stroke') : solid(o.stroke)];
    if (o.op != null) node.opacity = o.op;
  }
}
async function applyOverrides(inst, entry, n, safeOnly) {
  const depth = (o) => String(o.s).split('.').length;
  const list = (n.cmp.ov || []).map((o, i) => ({ o, i })).sort((a, b) => (('v' in a.o) ? 0 : 1) - (('v' in b.o) ? 0 : 1) || (('v' in a.o) ? depth(a.o) - depth(b.o) : 0) || a.i - b.i);
  let fails = 0, content = 0;
  for (const { o } of list) {
    if (safeOnly && !(('t' in o && !o.r) || 'b' in o || 'v' in o)) continue;
    try { await applyOne(inst, entry, o, n); ds.ovApplied++; } catch (e) { fails++; ds.ovFail++; if ('t' in o || 'b' in o || 'ic' in o || 'img' in o || 'v' in o) content++; note('override ' + o.s, e); }
  }
  return { fails, content };
}
// E4: a resized instance keeps its stroke weight, so scale it by hand: svg stroke-width (viewBox units) * rendered size / viewBox width
function fixIconStroke(inst, svg, size) {
  let sw = 2, vb = 24;
  if (svg) {
    const a = /stroke-width="([0-9.]+)"/.exec(svg), b = /viewBox="[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)/.exec(svg);
    if (!a) return; sw = Number(a[1]); if (b) vb = Number(b[1]);
  }
  const target = Math.round(sw * size / vb * 1000) / 1000;
  for (const v of vectorsOf(inst)) if (v.strokes && v.strokes.length && typeof v.strokeWeight === 'number' && Math.abs(v.strokeWeight - target) > 0.01) v.strokeWeight = target;
}
function svgColour(svg) {
  const m = /(?:stroke|fill)="rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)"/.exec(svg || '');
  return m ? { r: m[1] / 255, g: m[2] / 255, b: m[3] / 255, a: m[4] == null ? 1 : Number(m[4]) } : null;
}
function iconStyle(inst, n) {
  fixIconStroke(inst, n.svg, Math.max(n.w, 1));
  if (n.cmp.c) { recolourVectors(inst, n.cmp.c, 'icon'); return; }
  const lit = svgColour(n.svg), vec = vectorsOf(inst)[0];
  if (lit && vec) {
    const p = (vec.strokes && vec.strokes[0]) || (vec.fills && vec.fills[0]);
    if (p && p.type === 'SOLID' && (Math.abs(p.color.r - lit.r) > 1 / 255 || Math.abs(p.color.g - lit.g) > 1 / 255 || Math.abs(p.color.b - lit.b) > 1 / 255)) recolourVectors(inst, null, 'icon', lit);
  }
}
// bounds check against the source rectangles; text drift is tolerated like evalDev does
function checkKids(inst, n) {
  if (!n.children || !n.children.length) return null;
  const vis = (inst.children || []).filter((k) => k.visible !== false);
  if (vis.length !== n.children.length) return 'child count ' + vis.length + ' vs ' + n.children.length;
  const slack = 3 + 0.06 * Math.max(n.w, 1);
  for (let i = 0; i < vis.length; i++) {
    const k = vis[i], d = n.children[i];
    const dx = k.x - d.x, dy = k.y - d.y, dw = k.width - d.w, dh = k.height - d.h;
    const isText = d.t === 'text';
    const tw = isText ? Math.max(6, 0.2 * d.w) : 2 + 0.08 * d.w, th = isText ? Math.max(2.5, 0.5 * d.h) : 2 + 0.08 * d.h;
    if (Math.abs(dw) > tw || Math.abs(dh) > th || Math.abs(dx) > slack || Math.abs(dy) > slack) return (d.name || d.t) + ' dx' + Math.round(dx) + ' dy' + Math.round(dy) + ' dw' + Math.round(dw) + ' dh' + Math.round(dh);
  }
  return null;
}
function fillMismatch(inst, n) {
  if (!n.fill || !inst.fills || !inst.fills.length || inst.fills[0].type !== 'SOLID' || (inst.fills[0].boundVariables && inst.fills[0].boundVariables.color)) return false;
  const p = inst.fills[0], a = p.opacity == null ? 1 : p.opacity;
  return Math.abs(p.color.r - n.fill.r) > 1 / 255 || Math.abs(p.color.g - n.fill.g) > 1 / 255 || Math.abs(p.color.b - n.fill.b) > 1 / 255 || Math.abs(a - n.fill.a) > 0.02;
}
// one attempt at an instance; rung 0 = all overrides, 1 = safe overrides only, 2 = full overrides then detach (loose check)
async function attemptInstance(entry, n, parent, rung, isIcon) {
  const c = n.cmp, w = Math.max(n.w, 1), h = Math.max(n.h, 1);
  const main = pickVariant(entry, c.v, isIcon ? Math.round(n.w) : 0); if (!main) throw new Error('no variant for ' + c.id);
  let inst = main.createInstance();
  try {
    attach(parent, inst, n);
    postPlace(inst, n, parent);
    safe('instName', () => { inst.name = n.name || entry.name; });
    let fails = 0, content = 0;
    if (!isIcon && c.ov && c.ov.length) ({ fails, content } = await applyOverrides(inst, entry, n, rung === 1));
    // natural size of hugging axes (before the resize) is the meaningful text-metric check
    let hugX = false, hugY = false;
    safe('hug', () => { hugX = inst.layoutSizingHorizontal === 'HUG'; hugY = inst.layoutSizingVertical === 'HUG'; });
    const nat = { w: inst.width, h: inst.height };
    const k = rung === 2 ? 2 : 1;
    let bad = content ? 'content override failed (' + content + ')' : null; // wrong text or visibility is worse than no component: fall to the plain frame
    if (!bad && !isIcon) {
      if (hugX && n.ls && n.ls.s && n.ls.s[0] === 'H' && Math.abs(nat.w - n.w) > k * Math.max(6, 0.2 * n.w)) bad = 'width ' + Math.round(nat.w) + ' vs ' + Math.round(n.w);
      if (!bad && hugY && n.ls && n.ls.s && n.ls.s[1] === 'H' && Math.abs(nat.h - n.h) > k * Math.max(4, 0.4 * n.h)) bad = 'height ' + Math.round(nat.h) + ' vs ' + Math.round(n.h);
    }
    safe('instResize', () => inst.resize(w, h)); // E2: instances resize like frames
    if (isIcon) safe('iconStyle', () => iconStyle(inst, n));
    if (n.opacity != null) safe('opacity', () => { inst.opacity = n.opacity; });
    if (n.blend) safe('blend', () => { inst.blendMode = BLEND(n.blend); });
    if (!bad && !isIcon && fillMismatch(inst, n)) safe('fixFill', () => { inst.fills = [solid(n.fill)]; ds.fixFill++; });
    if (!bad && !isIcon && rung < 2) bad = checkKids(inst, n);
    if (bad) { try { inst.remove(); } catch (e) { /* already gone */ } return { ok: false, why: bad, final: !!content }; }
    if (rung === 2) { inst = inst.detachInstance(); safe('detachSize', () => inst.resize(w, h)); }
    DRIFT.set(inst.id, { w: isIcon ? 0 : Math.abs(nat.w - n.w), h: isIcon ? 0 : Math.abs(nat.h - n.h) });
    return { ok: true, inst, fails };
  } catch (e) { try { inst.remove(); } catch (x) { /* ignore */ } throw e; }
}
async function tryInstance(n, parent) {
  const c = n.cmp;
  if (c.rej) { ds.rejected++; return null; }
  const entry = REG.get(c.id);
  if (!entry) { ds.missing++; return null; }
  const isIcon = c.kind === 'icon' || /^ic_/.test(c.id);
  if (++instTick % 24 === 0) await tick(); // E3: yield every 24 instances
  for (const rung of isIcon ? [0] : [0, 1, 2]) {
    let r;
    try { r = await attemptInstance(entry, n, parent, rung, isIcon); } catch (e) { stats.styleFail++; note('instance ' + (n.name || c.id), e); break; }
    if (!r.ok) { if (noteVerify.length < 8) noteVerify.push('instance ' + (n.name || c.id) + ' rung ' + rung + ' failed: ' + r.why); if (r.final) break; continue; }
    ds.inst++; if (isIcon) ds.icons++;
    if (rung === 2) ds.detached++; else if (rung === 1 || r.fails) ds.r1++; else ds.r0++;
    processed += countNodes(n) - 1;
    return r.inst;
  }
  ds.plain++; // R3: the caller builds the plain frame from the retained children
  return null;
}

function inv(m) { // invert 2x3 affine [[a,b,tx],[c,d,ty]]
  const [[a, b, tx], [c, d, ty]] = m, det = a * d - b * c || 1e-9;
  return [[d / det, -b / det, (b * ty - d * tx) / det], [-c / det, a / det, (c * tx - a * ty) / det]];
}
function gradPaint(g, w, h, gr) {
  const n = g.stops.length;
  const stops = g.stops.map((s, i) => ({ position: Math.min(1, Math.max(0, s.pos != null ? s.pos : i / (n - 1))), color: { r: s.c.r, g: s.c.g, b: s.c.b, a: s.c.a } }));
  if (OPTS.bindTokens && TOKV) bindGradientStops(stops, g, gr); // E12: bound variable goes inside the paint literal
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
  if (n.fill) fills.push(paintFor(n.fill, n.tok && n.tok.f, 'fill'));
  if (n.layers) {
    for (const l of [...n.layers].reverse()) {
      if (l.k === 'grad') fills.push(gradPaint(l, w, h, n.tok && n.tok.gr));
      else if (l.k === 'img') { const p = imagePaint(l, l.mode); if (p) fills.push(p); else stats.imgFail++; }
    }
  } else if (n.grads) for (const g of [...n.grads].reverse()) fills.push(gradPaint(g, w, h, n.tok && n.tok.gr));
  return fills;
}

const BLEND = (b) => String(b).toUpperCase().replace(/-/g, '_');
// styling shared by frames and rectangles
function styleBox(f, n, isFrame) {
  const w = Math.max(n.w, 1), h = Math.max(n.h, 1);
  safe('fills', () => { f.fills = buildFills(n, w, h); });
  if (n.stroke) safe('stroke', () => {
    f.strokes = [paintFor(n.stroke.c, n.tok && n.tok.s, 'stroke')]; f.strokeAlign = 'INSIDE';
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
  if (n.cmp && OPTS.useComponents && REG) { const inst = await tryInstance(n, parent); if (inst) return inst; } // R3 falls through to the plain path below
  if (n.t === 'text') {
    const t = figma.createText();
    const f = n.font;
    t.fontName = await fontFor(f.family, f.weight);
    if (managed) safe('textMode', () => { t.textAutoResize = L.s[0] === 'H' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT'; });
    t.characters = n.text;
    t.fontSize = Math.max(f.size, 1);
    safe('lineHeight', () => { if (f.lh) t.lineHeight = { unit: 'PIXELS', value: f.lh }; else if (L && L.tx && L.tx.lh) t.lineHeight = { unit: 'PIXELS', value: L.tx.lh }; });
    safe('letterSpacing', () => { if (f.ls) t.letterSpacing = { unit: 'PIXELS', value: f.ls }; });
    if (OPTS.bindTokens && n.tok && n.tok.ts) await bindTextStyle(t, n.tok.ts, f); // style first, runs are re-applied below (E11)
    safe('textFill', () => { t.fills = [paintFor(f.color, n.tok && n.tok.tx, 'text')]; });
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
      if (OPTS.bindTokens && n.tok && n.tok.ic) safe('svgTok', () => recolourVectors(s, n.tok.ic, 'icon'));
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
  if (OPTS.bindTokens && n.tok) await bindFrameTok(f, n);
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
  if (OPTS.bindTokens && n.tok && L.k !== 'G') safe('bindLayout', () => bindLayoutTok(f, n, p));
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
  OPTS = Object.assign({ bindVars: false, autoLayout: true, useComponents: false, bindTokens: false }, msg.opts || {});
  DRIFT.clear(); noteVerify.length = 0;
  for (const k of Object.keys(ds)) ds[k] = 0;
  TOKV = null; REG = null; LIB = msg.lib || null; TOKFILE = msg.tokens || null; instTick = 0; numOf.clear();
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
    if (OPTS.bindVars || OPTS.bindTokens) await loadColorVariables();
    if (OPTS.bindTokens) await loadTokenRegistry();
    if (OPTS.useComponents) await loadComponentRegistry();

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
    if (OPTS.useComponents || OPTS.bindTokens) say('Design system: instances ' + ds.inst + ' (R0 ' + ds.r0 + ', R1 ' + ds.r1 + ', detached ' + ds.detached + '), icons ' + ds.icons + ', plain-frame fallbacks ' + ds.plain + ' (missing master ' + ds.missing + ', left plain by tool ' + ds.rejected + '), override failures ' + ds.ovFail + ', token bindings ' + ds.tokBound + ' (no match ' + ds.tokMiss + '), root fill fixes ' + ds.fixFill + ', variant holes ' + ds.fuzzyVariant + '.');
    if (noteVerify.length) say('Degraded containers (first ' + noteVerify.length + '): ' + noteVerify.join(' | '));
    const bad = s.svgFail + s.imgFail + s.nodeFail + s.styleFail;
    if (!bad && (ds.ovFail || ds.tokMiss) && failNotes.length) say('Notes:' + String.fromCharCode(10) + '  ' + failNotes.join(String.fromCharCode(10) + '  '));
    say(bad ? 'FAILURES: svg ' + s.svgFail + ', image placeholders ' + s.imgFail + ', nodes ' + s.nodeFail + ', style steps ' + s.styleFail + (failNotes.length ? '\n  ' + failNotes.join('\n  ') : '') : 'No failures.');
    figma.ui.postMessage({ progress: { done: total, total, screen: 'done' }, finished: true });
  } catch (e) { say('Error: ' + (e && e.message ? e.message : e)); figma.ui.postMessage({ finished: true }); }
};
