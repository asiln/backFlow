// Figma Lift Tokens: reads tokens.json (docs/ds-schema/tokens.schema.json) and the open file, three actions in one UI:
//   dry       every lookup, per-token status, changes nothing (a write attempt throws)
//   apply     creates ONLY what is missing; idempotent; never renames, deletes or overwrites designer-made things
//   inventory writes ds-inventory.json (docs/ds-schema/inventory.schema.json, spec 7.3)
// Plain ES2017 on purpose (no ?. or ??), same style as plugin/code.js and plugin/verify-ds/code.js.
figma.showUI(__html__, { width: 600, height: 760 });

// ---------- config: names are the keys of docs/verify-ds.cfg.json (values measured in real Figma, see docs/VERIFY-DS-RESULTS.md) ----------
const multiModeAvailable = false;          // E14: a second mode is not available (plan limit): one mode per collection
const letterSpacingUnit = 'PERCENT';       // E13: letter spacing is exact in percent
const lineHeightFractionalExact = true;    // E13: fractional line height is exact in px
const codeSyntaxWorks = true;              // E14: WEB code syntax persists
const variableScopesPersist = true;        // E14: scopes persist
const aliasChainWorks = true;              // E14: alias chains persist
const effectStyleBindsVariable = true;     // E12: effect styles keep a bound colour variable
const gradientStopBindForm = 'stops[i].boundVariables.color inside the paint literal'; // E12 (gradient styles are not created by this plugin)
const instanceBatchSize = 24;              // not used here; kept so the config block matches the verify file
// plugin-local settings
const BATCH = 25;                          // items per UI yield
const NS = 'figmalift';                    // shared plugin data namespace (spec 4.6)
const FALLBACK_FAMILY = 'Inter';
const FALLBACK_STYLE = 'Regular';
const FONT_MAP = {};                       // family -> family (ds.config.json fontMap; empty = identity)
const COLLECTION_MODE_NAME = 'Value';      // name of the single mode of a collection created here
const PRIMITIVES_COLLECTION = 'Primitives';
const ALPHA_TOL = 0.02;                    // colour compare, matches tokens alphaTol default
const AUTO_ALIAS_PRIMITIVES = true;        // semantic colour aliases a Primitives variable of the same value when exactly one exists
const ICON_MAX_SIZE = 64;                  // inventory: a standalone component up to this size made only of vectors is an icon
const FP_MAX_DEPTH = 6;                    // inventory fingerprint limits
const FP_MAX_KIDS = 40;
const FP_MAX_VARIANTS = 64;
const REG_CHUNK = 60000;                   // registry chunk size (plugin data value limit)

const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const SCOPES = ['ALL_SCOPES', 'TEXT_CONTENT', 'CORNER_RADIUS', 'WIDTH_HEIGHT', 'GAP', 'ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR', 'STROKE_FLOAT',
  'EFFECT_FLOAT', 'EFFECT_COLOR', 'OPACITY', 'FONT_FAMILY', 'FONT_STYLE', 'FONT_WEIGHT', 'FONT_SIZE', 'LINE_HEIGHT', 'LETTER_SPACING', 'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT'];
const ROLE_SCOPES = { fill: ['FRAME_FILL', 'SHAPE_FILL'], text: ['TEXT_FILL'], stroke: ['STROKE_COLOR'], icon: ['SHAPE_FILL', 'STROKE_COLOR'], shadow: ['EFFECT_COLOR'], 'gradient-stop': ['FRAME_FILL', 'SHAPE_FILL'] };
const FAMILY_SCOPES = { radius: ['CORNER_RADIUS'], spacing: ['GAP'], size: ['WIDTH_HEIGHT'] };

// ---------- small helpers ----------
const post = (m) => { try { figma.ui.postMessage(m); } catch (e) { /* UI closed */ } };
const say = (log) => post({ log: log });
const tick = () => new Promise((r) => setTimeout(r, 0));
const msg = (e) => (e && e.message ? e.message : String(e));
const hasFn = (o, n) => !!o && typeof o[n] === 'function';
const hex2 = (n) => ('0' + Math.round(n * 255).toString(16)).slice(-2).toUpperCase();
const fmtColor = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + '@' + Math.round((c.a === undefined ? 1 : c.a) * 100);
function parseHex(h, a) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(h || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: a === undefined ? 1 : a };
}
const colorsClose = (x, y, tol) => {
  const t = tol === undefined ? 1.01 : tol; // channel tolerance in 1/255 steps
  return Math.abs(x.r - y.r) * 255 <= t && Math.abs(x.g - y.g) * 255 <= t && Math.abs(x.b - y.b) * 255 <= t &&
    Math.abs((x.a === undefined ? 1 : x.a) - (y.a === undefined ? 1 : y.a)) <= ALPHA_TOL;
};
function hash10(str) { // FNV-1a x2, 10 hex chars
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xa5a5a5a5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8)).slice(0, 10);
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- run state ----------
let cancelled = false;
let DRY = true;
let running = false;
const writes = { count: 0, byKind: {} };
function W(kind, fn) { // every mutation goes through here; refuses in dry run
  if (DRY) throw new Error('write attempted during dry run: ' + kind);
  writes.count++; writes.byKind[kind] = (writes.byKind[kind] || 0) + 1;
  return fn();
}

// ---------- index of what the file already holds ----------
let IDX = null;
let FONTS = null; // Map family -> Set(style)
async function loadFonts() {
  if (FONTS) return FONTS;
  FONTS = new Map();
  try {
    const list = await figma.listAvailableFontsAsync();
    for (const f of list) { if (!FONTS.has(f.fontName.family)) FONTS.set(f.fontName.family, new Set()); FONTS.get(f.fontName.family).add(f.fontName.style); }
  } catch (e) { FONTS = new Map(); say('Could not list fonts: ' + msg(e)); }
  return FONTS;
}
function readStamp(obj) {
  if (!hasFn(obj, 'getSharedPluginData')) return null;
  try { const k = obj.getSharedPluginData(NS, 'tokenKey'); return k ? { key: k, role: obj.getSharedPluginData(NS, 'tokenRole') || '' } : null; } catch (e) { return null; }
}
async function loadRegistry() {
  const reg = {};
  try {
    const n = parseInt(figma.root.getSharedPluginData(NS, 'reg.n') || '0', 10);
    let s = '';
    for (let i = 0; i < n; i++) s += figma.root.getSharedPluginData(NS, 'reg.' + i);
    if (s) Object.assign(reg, JSON.parse(s));
  } catch (e) { say('Registry unreadable (ignored): ' + msg(e)); }
  return reg;
}
async function buildIndex() {
  IDX = { reg: await loadRegistry(), regDirty: false, collById: new Map(), collByName: new Map(), varById: new Map(), varByName: new Map(), varByKey: new Map(),
    textById: new Map(), textByName: new Map(), textByKey: new Map(), fxById: new Map(), fxByName: new Map(), fxByKey: new Map(), prims: [], virt: new Map(), dupNames: 0 };
  for (const c of await figma.variables.getLocalVariableCollectionsAsync()) { IDX.collById.set(c.id, c); if (!IDX.collByName.has(c.name)) IDX.collByName.set(c.name, c); }
  const vars = await figma.variables.getLocalVariablesAsync();
  let n = 0;
  for (const v of vars) {
    indexVar(v);
    const st = readStamp(v);
    if (st) IDX.varByKey.set(st.key + '|' + st.role, v);
    if (++n % 400 === 0) await tick();
  }
  for (const rk of Object.keys(IDX.reg)) { // registry fallback: ids of objects created by this plugin
    const e = IDX.reg[rk]; const parts = rk.split('|');
    if (parts[0] === 'v' && IDX.varById.has(e.id) && !IDX.varByKey.has(parts[1] + '|' + parts[2])) IDX.varByKey.set(parts[1] + '|' + parts[2], IDX.varById.get(e.id));
  }
  for (const s of await figma.getLocalTextStylesAsync()) indexStyle('text', s);
  for (const s of await figma.getLocalEffectStylesAsync()) indexStyle('fx', s);
  for (const rk of Object.keys(IDX.reg)) {
    const e = IDX.reg[rk]; const parts = rk.split('|');
    if (parts[0] === 't' && IDX.textById.has(e.id) && !IDX.textByKey.has(parts[1])) IDX.textByKey.set(parts[1], IDX.textById.get(e.id));
    if (parts[0] === 'e' && IDX.fxById.has(e.id) && !IDX.fxByKey.has(parts[1])) IDX.fxByKey.set(parts[1], IDX.fxById.get(e.id));
  }
}
function collName(v) { const c = IDX.collById.get(v.variableCollectionId); return c ? c.name : ''; }
function indexVar(v) {
  IDX.varById.set(v.id, v);
  const k = collName(v) + '\u0001' + v.name;
  if (!IDX.varByName.has(k)) IDX.varByName.set(k, v);
  if (v.resolvedType === 'COLOR' && collName(v) === PRIMITIVES_COLLECTION) IDX.prims.push({ name: v.name, variable: v, color: firstValue(v) });
}
function indexStyle(kind, s) {
  const byId = kind === 'text' ? IDX.textById : IDX.fxById, byName = kind === 'text' ? IDX.textByName : IDX.fxByName, byKey = kind === 'text' ? IDX.textByKey : IDX.fxByKey;
  byId.set(s.id, s); if (!byName.has(s.name)) byName.set(s.name, s);
  const st = readStamp(s); if (st) byKey.set(st.key, s);
}
function firstModeId(coll) { return coll && coll.modes && coll.modes.length ? coll.modes[0].modeId : null; }
function firstValue(v, depth) { // first-mode value, alias chain resolved
  const coll = IDX.collById.get(v.variableCollectionId);
  let val = v.valuesByMode ? v.valuesByMode[firstModeId(coll)] : undefined;
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    const t = IDX.varById.get(val.id);
    if (!t || (depth || 0) > 8) return undefined;
    return firstValue(t, (depth || 0) + 1);
  }
  return val;
}
function stamp(kind, obj, key, role, ver) {
  const rk = kind + '|' + key + '|' + (role || '');
  IDX.reg[rk] = { id: obj.id, ver: ver }; IDX.regDirty = true;
  if (hasFn(obj, 'setSharedPluginData')) {
    try { obj.setSharedPluginData(NS, 'tokenKey', key); obj.setSharedPluginData(NS, 'tokenRole', role || ''); obj.setSharedPluginData(NS, 'tokensVer', ver); } catch (e) { say('plugin data not writable on ' + kind + ' (registry used): ' + msg(e)); }
  }
}
function flushRegistry() {
  if (DRY || !IDX || !IDX.regDirty) return;
  const s = JSON.stringify(IDX.reg);
  const old = parseInt(figma.root.getSharedPluginData(NS, 'reg.n') || '0', 10);
  const n = Math.ceil(s.length / REG_CHUNK);
  for (let i = 0; i < n; i++) figma.root.setSharedPluginData(NS, 'reg.' + i, s.slice(i * REG_CHUNK, (i + 1) * REG_CHUNK));
  for (let i = n; i < old; i++) figma.root.setSharedPluginData(NS, 'reg.' + i, '');
  figma.root.setSharedPluginData(NS, 'reg.n', String(n));
  IDX.regDirty = false;
}
const tokensVer = (obj) => hash10(JSON.stringify(obj));

// ---------- result bookkeeping ----------
let ITEMS = [];
function add(family, t, name, status, detail, extra) {
  const it = { family: family, key: t && t.key ? t.key : '', name: name || '', status: status, detail: detail || '' };
  if (t && t.role) it.role = t.role;
  if (t && t.status) it.tokenStatus = t.status;
  if (extra) Object.assign(it, extra);
  ITEMS.push(it);
  return it;
}
function summarize(items) {
  const byStatus = {}, byFamily = {};
  for (const it of items) {
    byStatus[it.status] = (byStatus[it.status] || 0) + 1;
    if (!byFamily[it.family]) byFamily[it.family] = {};
    byFamily[it.family][it.status] = (byFamily[it.family][it.status] || 0) + 1;
  }
  return { byStatus: byStatus, byFamily: byFamily };
}
const doneWord = () => (DRY ? 'would create' : 'created');

// ---------- variables ----------
function desired(family, t) { // -> { type, value } or { skip: reason }
  if (family === 'color') {
    const c = parseHex(t.hex, t.a);
    return c ? { type: 'COLOR', value: c } : { skip: 'bad hex ' + t.hex };
  }
  let m;
  if (family === 'radius') { m = /^r:(-?[\d.]+)$/.exec(t.key); if (!m) return { skip: 'per-corner radius cannot be one variable' }; }
  else if (family === 'spacing') { m = /^sp:(-?[\d.]+)$/.exec(t.key); if (!m) return { skip: 'bad spacing key' }; }
  else if (family === 'size') { m = /^sz:h(-?[\d.]+)$/.exec(t.key); if (!m) return { skip: 'bad size key' }; }
  return m ? { type: 'FLOAT', value: parseFloat(m[1]) } : { skip: 'unsupported key' };
}
function scopesFor(family, t) {
  const tg = t.target || {};
  let s = tg.scopes && tg.scopes.length ? tg.scopes.slice() : (family === 'color' ? (tg.collection === PRIMITIVES_COLLECTION ? [] : ROLE_SCOPES[t.role] || ['ALL_SCOPES']) : FAMILY_SCOPES[family] || ['ALL_SCOPES']);
  const bad = s.filter((x) => SCOPES.indexOf(x) < 0);
  s = s.filter((x) => SCOPES.indexOf(x) >= 0);
  return { scopes: s, bad: bad };
}
function webSyntax(family, t) {
  const tg = t.target || {};
  if (tg.codeSyntax && tg.codeSyntax.WEB) return tg.codeSyntax.WEB;
  const tw = t.tailwind;
  if (!tw) return null;
  if (family === 'color') return 'colors.' + tw;
  if (family === 'radius') return 'borderRadius.' + (tw === 'rounded' ? 'DEFAULT' : tw.replace(/^rounded-/, ''));
  if (family === 'spacing') return /^[a-z]+-/.test(tw) ? 'spacing.' + tw.replace(/^[a-z]+-/, '') : null;
  return null;
}
function sameVar(type, a, b) {
  if (a === undefined || b === undefined) return false;
  if (type === 'COLOR') return a && b && typeof a === 'object' && colorsClose(a, b);
  return Math.abs(a - b) < 0.001;
}
const fmtVal = (type, v) => (v === undefined ? '(alias unresolved)' : type === 'COLOR' ? fmtColor(v) : String(v));
function findVar(t) {
  const tg = t.target || {};
  const role = t.role || '';
  let v = t.existing && t.existing.id ? IDX.varById.get(t.existing.id) : null;
  if (v) return { v: v, how: 'id' };
  v = IDX.varByKey.get(t.key + '|' + role);
  if (v) return { v: v, how: 'key' };
  v = IDX.varByName.get((tg.collection || '') + '\u0001' + tg.name);
  if (v) return { v: v, how: 'name' };
  const virt = IDX.virt.get((tg.collection || '') + '\u0001' + tg.name);
  if (virt) return { virt: virt, how: 'this run' };
  return null;
}
async function ensureCollection(name, t) {
  let c = IDX.collByName.get(name);
  if (c) return c;
  if (DRY) {
    if (!IDX.virt.has('coll\u0001' + name)) { IDX.virt.set('coll\u0001' + name, true); add('collection', null, name, 'would create', 'one mode "' + COLLECTION_MODE_NAME + '"'); }
    return null;
  }
  c = W('collection', () => figma.variables.createVariableCollection(name));
  try { if (c.modes && c.modes.length) W('mode', () => c.renameMode(c.modes[0].modeId, COLLECTION_MODE_NAME)); } catch (e) { say('could not rename mode of ' + name + ': ' + msg(e)); }
  IDX.collById.set(c.id, c); IDX.collByName.set(name, c);
  add('collection', null, name, 'created', 'one mode "' + COLLECTION_MODE_NAME + '"', { id: c.id });
  return c;
}
function findPrimitive(t, want) {
  const tg = t.target || {};
  if (tg.alias) { // explicit alias from the token map: "Primitives/gray/900" or "gray/900"
    const nm = tg.alias.indexOf(PRIMITIVES_COLLECTION + '/') === 0 ? tg.alias.slice(PRIMITIVES_COLLECTION.length + 1) : tg.alias;
    const hit = IDX.prims.filter((p) => p.name === nm)[0];
    return hit ? { p: hit } : { miss: 'alias target ' + tg.alias + ' not found, literal value used' };
  }
  if (!AUTO_ALIAS_PRIMITIVES || tg.collection === PRIMITIVES_COLLECTION) return {};
  const hits = IDX.prims.filter((p) => p.color && colorsClose(p.color, want, 0.5));
  if (hits.length === 1) return { p: hits[0] };
  if (hits.length > 1) return { miss: hits.length + ' primitives share this value, no alias' };
  return {};
}
async function handleVariable(family, t) {
  const tg = t.target || {};
  if (t.status === 'skip' || t.status === 'off-scale') {
    add(family, t, tg.name, 'skipped', t.status === 'off-scale' ? 'off-scale' + (t.nearest ? ' (nearest ' + t.nearest + ')' : '') : 'below thresholds, stays literal');
    return;
  }
  const want = desired(family, t);
  if (want.skip) { add(family, t, tg.name, 'skipped', want.skip); return; }
  if (!tg.name || !tg.collection) { add(family, t, tg.name, 'skipped', 'no target in tokens.json'); return; }
  const found = findVar(t);
  if (found) {
    if (found.virt) { // dry run: created earlier in this same run
      if (sameVar(want.type, found.virt.value, want.value)) add(family, t, tg.name, 'exists', 'same name and value as an item created earlier in this run');
      else add(family, t, tg.name, 'conflict', 'name taken by another token in this run with a different value', { fileValue: fmtVal(want.type, found.virt.value), tokenValue: fmtVal(want.type, want.value) });
      return;
    }
    const v = found.v, cur = firstValue(v);
    const info = { id: v.id };
    if (found.how === 'key' && (v.name !== tg.name || collName(v) !== tg.collection)) info.renamedTo = collName(v) + '/' + v.name;
    if (v.resolvedType !== want.type) { add(family, t, tg.name, 'conflict', 'file variable is ' + v.resolvedType + ', token is ' + want.type, info); return; }
    if (sameVar(want.type, cur, want.value)) {
      if (OPTS.adopt && !readStamp(v) && !DRY) { stamp('v', v, t.key, t.role, tokensVer({ k: t.key, r: t.role, tg: tg })); info.adopted = true; }
      add(family, t, tg.name, 'exists', 'found by ' + found.how + (info.renamedTo ? ' (renamed in file: ' + info.renamedTo + ')' : ''), info);
    } else {
      info.fileValue = fmtVal(want.type, cur); info.tokenValue = fmtVal(want.type, want.value);
      add(family, t, tg.name, 'conflict', 'value differs (found by ' + found.how + '), file value kept', info);
    }
    return;
  }
  if (t.status === 'review' && !OPTS.createReview) {
    add(family, t, tg.name, 'review', 'ambiguous token, nothing created' + (t.candidates && t.candidates.length ? '; candidates: ' + t.candidates.map((c) => c.name).join(', ') : ''), t.candidates ? { candidates: t.candidates } : undefined);
    return;
  }
  // missing: would create / create
  const sc = scopesFor(family, t);
  const syn = webSyntax(family, t);
  let alias = {};
  if (want.type === 'COLOR') alias = findPrimitive(t, want.value);
  const notes = [];
  if (t.status === 'bound') notes.push('tokens.json expected it to exist');
  if (sc.bad.length) notes.push('unknown scopes dropped: ' + sc.bad.join(','));
  if (alias.miss) notes.push(alias.miss);
  const coll = await ensureCollection(tg.collection, t);
  if (DRY) {
    IDX.virt.set(tg.collection + '\u0001' + tg.name, { value: want.value });
    if (want.type === 'COLOR' && tg.collection === PRIMITIVES_COLLECTION) IDX.prims.push({ name: tg.name, variable: null, color: want.value });
    add(family, t, tg.name, 'would create', [tg.collection + '/' + tg.name, alias.p ? 'alias of ' + PRIMITIVES_COLLECTION + '/' + alias.p.name : fmtVal(want.type, want.value), 'scopes ' + sc.scopes.join('|'), syn ? 'WEB ' + syn : ''].concat(notes).filter(Boolean).join('; '));
    return;
  }
  const ver = tokensVer({ k: t.key, r: t.role, tg: tg, h: t.hex, a: t.a });
  const v = W('variable', () => figma.variables.createVariable(tg.name, coll, want.type));
  stamp('v', v, t.key, t.role, ver); // first, so a half-built variable is still found next run
  indexVar(v); IDX.varByKey.set(t.key + '|' + (t.role || ''), v);
  const warn = notes.slice();
  const step = (label, fn) => { try { fn(); } catch (e) { warn.push(label + ' failed: ' + msg(e)); } };
  const modes = coll.modes && coll.modes.length ? (multiModeAvailable ? coll.modes : coll.modes.slice(0, 1)) : [];
  for (const m of modes) {
    step('value', () => W('value', () => v.setValueForMode(m.modeId, aliasChainWorks && alias.p && alias.p.variable ? figma.variables.createVariableAlias(alias.p.variable) : want.value)));
  }
  if (variableScopesPersist) step('scopes', () => W('scopes', () => { v.scopes = sc.scopes; }));
  if (codeSyntaxWorks && syn) step('codeSyntax', () => W('codeSyntax', () => v.setVariableCodeSyntax('WEB', syn)));
  if (tg.collection === PRIMITIVES_COLLECTION) step('hiddenFromPublishing', () => W('hidden', () => { v.hiddenFromPublishing = true; }));
  if (want.type === 'COLOR' && tg.collection === PRIMITIVES_COLLECTION) IDX.prims.push({ name: v.name, variable: v, color: want.value });
  add(family, t, tg.name, 'created', [tg.collection + '/' + tg.name, alias.p ? 'alias of ' + PRIMITIVES_COLLECTION + '/' + alias.p.name : fmtVal(want.type, want.value)].concat(warn).join('; '), { id: v.id, warnings: warn.length ? warn : undefined });
}

// ---------- text styles ----------
function parseTextKey(key) { // t:<family>/<size>/<weight>/<lh px>/<ls em>
  const m = /^t:(.+)\/(-?[\d.]+)\/(\d+)\/(-?[\d.]+)\/(-?[\d.]+)$/.exec(key);
  return m ? { family: m[1], size: parseFloat(m[2]), weight: parseInt(m[3], 10), lh: parseFloat(m[4]), ls: parseFloat(m[5]) } : null;
}
function pickStyle(family, weight) {
  const styles = FONTS.get(family);
  const w = Math.round(weight / 100) * 100;
  const order = [w, w + 100, w - 100, w + 200, w - 200, 400].filter((x) => x >= 100 && x <= 900);
  if (styles) for (const o of order) { if (styles.has(WEIGHT_NAMES[o])) return WEIGHT_NAMES[o]; }
  return FALLBACK_STYLE;
}
function resolveFont(family, weight) {
  const want = FONT_MAP[family] || family;
  const notes = [];
  let fam = want;
  if (FONTS.size && !FONTS.has(want)) { notes.push('font ' + want + ' not installed, using ' + FALLBACK_FAMILY); fam = FALLBACK_FAMILY; }
  const style = FONTS.size ? pickStyle(fam, weight) : (WEIGHT_NAMES[Math.round(weight / 100) * 100] || FALLBACK_STYLE);
  const exact = WEIGHT_NAMES[Math.round(weight / 100) * 100];
  if (style !== exact && fam === want) notes.push(want + ' has no ' + exact + ', mapped to ' + style);
  return { family: fam, style: style, notes: notes };
}
const normStyle = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
function lsPercent(ls, size) { return !ls ? 0 : ls.unit === 'PERCENT' ? ls.value : size ? (ls.value / size) * 100 : 0; }
function textDiff(s, p, font) {
  const d = [];
  if (s.fontName.family !== font.family || normStyle(s.fontName.style) !== normStyle(font.style)) d.push('font ' + s.fontName.family + ' ' + s.fontName.style + ' vs ' + font.family + ' ' + font.style);
  if (Math.abs(s.fontSize - p.size) > 0.01) d.push('size ' + s.fontSize + ' vs ' + p.size);
  const lh = s.lineHeight;
  if (p.lh > 0 && !(lh && lh.unit === 'PIXELS' && Math.abs(lh.value - p.lh) <= (lineHeightFractionalExact ? 0.05 : 0.5))) d.push('line height ' + (lh ? lh.unit + ' ' + (lh.value === undefined ? '' : lh.value) : '?') + ' vs ' + p.lh + 'px');
  if (Math.abs(lsPercent(s.letterSpacing, s.fontSize) - p.ls * 100) > 0.1) d.push('letter spacing ' + Math.round(lsPercent(s.letterSpacing, s.fontSize) * 100) / 100 + '% vs ' + Math.round(p.ls * 10000) / 100 + '%');
  return d;
}
function findStyle(kind, t, name) {
  const byId = kind === 'text' ? IDX.textById : IDX.fxById, byKey = kind === 'text' ? IDX.textByKey : IDX.fxByKey, byName = kind === 'text' ? IDX.textByName : IDX.fxByName;
  let s = t.existing && t.existing.id ? byId.get(t.existing.id) : null;
  if (s) return { s: s, how: 'id' };
  s = byKey.get(t.key); if (s) return { s: s, how: 'key' };
  s = byName.get(name); if (s) return { s: s, how: 'name' };
  const virt = IDX.virt.get(kind + '\u0001' + name);
  return virt ? { virt: virt, how: 'this run' } : null;
}
async function handleText(t) {
  const name = t.target && t.target.name;
  if (t.status === 'skip' || t.status === 'off-scale') { add('text', t, name, 'skipped', 'below thresholds, stays literal'); return; }
  const p = parseTextKey(t.key);
  if (!p) { add('text', t, name, 'skipped', 'cannot parse key'); return; }
  if (!name) { add('text', t, name, 'skipped', 'no target in tokens.json'); return; }
  await loadFonts();
  const font = resolveFont(p.family, p.weight);
  const found = findStyle('text', t, name);
  if (found) {
    if (found.virt) { add('text', t, name, 'exists', 'same name as an item created earlier in this run'); return; }
    const d = textDiff(found.s, p, font);
    const info = { id: found.s.id };
    if (found.how === 'key' && found.s.name !== name) info.renamedTo = found.s.name;
    if (!d.length) {
      if (OPTS.adopt && !readStamp(found.s) && !DRY) stamp('t', found.s, t.key, '', tokensVer({ k: t.key, tg: t.target }));
      add('text', t, name, 'exists', 'found by ' + found.how + (font.notes.length ? '; ' + font.notes.join('; ') : ''), info);
    } else { info.diff = d; add('text', t, name, 'conflict', 'differs (found by ' + found.how + '): ' + d.join('; ') + '; style kept', info); }
    return;
  }
  if (t.status === 'review' && !OPTS.createReview) { add('text', t, name, 'review', 'ambiguous token, nothing created'); return; }
  const what = [name, font.family + ' ' + font.style + ' ' + p.size + '/' + p.lh + 'px, ' + letterSpacingUnit + ' ' + Math.round(p.ls * 10000) / 100].concat(font.notes);
  if (t.status === 'bound') what.push('tokens.json expected it to exist');
  if (DRY) { IDX.virt.set('text\u0001' + name, true); add('text', t, name, 'would create', what.join('; ')); return; }
  const fname = { family: font.family, style: font.style };
  try { await figma.loadFontAsync(fname); } catch (e) { what.push('font load failed, ' + FALLBACK_FAMILY + ' ' + FALLBACK_STYLE + ' used'); fname.family = FALLBACK_FAMILY; fname.style = FALLBACK_STYLE; await figma.loadFontAsync(fname); }
  const s = W('textStyle', () => figma.createTextStyle());
  stamp('t', s, t.key, '', tokensVer({ k: t.key, tg: t.target }));
  indexStyle('text', s); IDX.textByKey.set(t.key, s);
  const warn = [];
  const step = (label, fn) => { try { fn(); } catch (e) { warn.push(label + ' failed: ' + msg(e)); } };
  step('name', () => { s.name = name; IDX.textByName.set(name, s); });
  step('font', () => { s.fontName = fname; });
  step('size', () => { s.fontSize = p.size; });
  step('lineHeight', () => { s.lineHeight = p.lh > 0 ? { unit: 'PIXELS', value: p.lh } : { unit: 'AUTO' }; });
  step('letterSpacing', () => { s.letterSpacing = { unit: letterSpacingUnit, value: Math.round(p.ls * 100 * 1000) / 1000 }; });
  add('text', t, name, 'created', what.concat(warn).join('; '), { id: s.id, warnings: warn.length ? warn : undefined });
}

// ---------- effect styles ----------
function parseEffectKey(key) {
  if (key.indexOf('e:') !== 0) return null;
  const out = [];
  for (const part of key.slice(2).split('|')) {
    const m = /^(i)?(-?[\d.]+),(-?[\d.]+),([\d.]+),(-?[\d.]+),([0-9a-fA-F]{6})@(\d+)$/.exec(part);
    if (!m) return null;
    out.push({ inset: !!m[1], x: parseFloat(m[2]), y: parseFloat(m[3]), blur: parseFloat(m[4]), spread: parseFloat(m[5]), hex: m[6].toLowerCase(), a: parseInt(m[7], 10) / 100 });
  }
  return out.length ? out : null;
}
function effectDiff(style, stack) {
  const fx = style.effects || [];
  if (fx.length !== stack.length) return ['effect count ' + fx.length + ' vs ' + stack.length];
  const d = [];
  stack.forEach((e, i) => {
    const f = fx[i], type = e.inset ? 'INNER_SHADOW' : 'DROP_SHADOW';
    const c = parseHex('#' + e.hex, e.a);
    if (f.type !== type) d.push('#' + i + ' type ' + f.type + ' vs ' + type);
    else if (!f.offset || Math.abs(f.offset.x - e.x) > 0.01 || Math.abs(f.offset.y - e.y) > 0.01 || Math.abs(f.radius - e.blur) > 0.01 || Math.abs((f.spread || 0) - e.spread) > 0.01) d.push('#' + i + ' geometry differs');
    else if (f.color && !colorsClose(f.color, c)) d.push('#' + i + ' colour ' + fmtColor(f.color) + ' vs ' + fmtColor(c));
  });
  return d;
}
function shadowColourVar(e) { // a colour variable the effect colour can bind to
  const key = 'c:' + e.hex + '@' + Math.round(e.a * 100);
  let v = IDX.varByKey.get(key + '|shadow');
  if (v) return v;
  const want = parseHex('#' + e.hex, e.a);
  for (const x of IDX.varById.values()) {
    if (x.resolvedType !== 'COLOR' || !x.scopes || (x.scopes.indexOf('EFFECT_COLOR') < 0 && x.scopes.indexOf('ALL_SCOPES') < 0)) continue;
    const val = firstValue(x);
    if (val && colorsClose(val, want, 0.5)) return x;
  }
  return null;
}
async function handleEffect(t) {
  const name = t.target && t.target.style;
  if (t.status === 'skip' || t.status === 'off-scale') { add('effect', t, name, 'skipped', 'below thresholds, stays literal'); return; }
  const stack = parseEffectKey(t.key);
  if (!stack) { add('effect', t, name, 'skipped', 'cannot parse key'); return; }
  if (!name) { add('effect', t, name, 'skipped', 'no target.style in tokens.json'); return; }
  const found = findStyle('fx', t, name);
  if (found) {
    if (found.virt) { add('effect', t, name, 'exists', 'same name as an item created earlier in this run'); return; }
    const d = effectDiff(found.s, stack), info = { id: found.s.id };
    if (!d.length) {
      if (OPTS.adopt && !readStamp(found.s) && !DRY) stamp('e', found.s, t.key, '', tokensVer({ k: t.key, tg: t.target }));
      add('effect', t, name, 'exists', 'found by ' + found.how, info);
    } else { info.diff = d; add('effect', t, name, 'conflict', 'differs (found by ' + found.how + '): ' + d.join('; ') + '; style kept', info); }
    return;
  }
  if (t.status === 'review' && !OPTS.createReview) { add('effect', t, name, 'review', 'ambiguous token, nothing created'); return; }
  const vars = stack.map((e) => (effectStyleBindsVariable ? shadowColourVar(e) : null));
  const what = [name, stack.length + ' shadow(s)', vars.map((v) => (v ? 'colour bound to ' + collName(v) + '/' + v.name : 'literal colour')).join(', ')];
  if (DRY) { IDX.virt.set('fx\u0001' + name, true); add('effect', t, name, 'would create', what.join('; ')); return; }
  const effects = stack.map((e, i) => {
    let eff = { type: e.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: parseHex('#' + e.hex, e.a), offset: { x: e.x, y: e.y }, radius: e.blur, spread: e.spread, visible: true, blendMode: 'NORMAL' };
    if (vars[i]) { try { eff = figma.variables.setBoundVariableForEffect(eff, 'color', vars[i]); } catch (err) { what.push('bind failed: ' + msg(err)); } }
    return eff;
  });
  const s = W('effectStyle', () => figma.createEffectStyle());
  stamp('e', s, t.key, '', tokensVer({ k: t.key, tg: t.target }));
  indexStyle('fx', s); IDX.fxByKey.set(t.key, s);
  const warn = [];
  try { s.name = name; IDX.fxByName.set(name, s); } catch (e) { warn.push('name failed: ' + msg(e)); }
  try { s.effects = effects; } catch (e) { warn.push('effects failed: ' + msg(e)); }
  add('effect', t, name, 'created', what.concat(warn).join('; '), { id: s.id, warnings: warn.length ? warn : undefined });
}

// ---------- token run (dry / apply) ----------
let OPTS = { createReview: false, adopt: false };
function buildTasks(tokens) {
  const tasks = [];
  const colors = tokens.colors || [];
  const prim = colors.filter((c) => c.target && c.target.collection === PRIMITIVES_COLLECTION), rest = colors.filter((c) => !(c.target && c.target.collection === PRIMITIVES_COLLECTION));
  prim.concat(rest).forEach((t) => tasks.push({ fam: 'color', t: t }));
  (tokens.radii || []).forEach((t) => tasks.push({ fam: 'radius', t: t }));
  (tokens.spacing || []).forEach((t) => tasks.push({ fam: 'spacing', t: t }));
  (tokens.sizes || []).forEach((t) => tasks.push({ fam: 'size', t: t }));
  (tokens.textStyles || []).forEach((t) => tasks.push({ fam: 'text', t: t }));
  (tokens.effects || []).forEach((t) => tasks.push({ fam: 'effect', t: t }));
  (tokens.gradients || []).forEach((t) => tasks.push({ fam: 'gradient', t: t }));
  return tasks;
}
async function runTokens(mode, tokens, opts) {
  DRY = mode === 'dry';
  OPTS = { createReview: !!(opts && opts.createReview), adopt: !!(opts && opts.adopt) };
  writes.count = 0; writes.byKind = {};
  ITEMS = [];
  say((DRY ? 'DRY RUN: nothing will be changed.' : 'APPLY: creating only what is missing.'));
  await buildIndex();
  say('File holds ' + IDX.collById.size + ' collections, ' + IDX.varById.size + ' variables, ' + IDX.textById.size + ' text styles, ' + IDX.fxById.size + ' effect styles. Registry entries: ' + Object.keys(IDX.reg).length + '.');
  const tasks = buildTasks(tokens);
  let i = 0, failed = 0;
  for (; i < tasks.length; i++) {
    if (cancelled) break;
    const k = tasks[i];
    try {
      if (k.fam === 'text') await handleText(k.t);
      else if (k.fam === 'effect') await handleEffect(k.t);
      else if (k.fam === 'gradient') add('gradient', k.t, k.t.target && k.t.target.style, 'skipped', 'gradient paint styles are not created by this plugin (' + gradientStopBindForm + ')');
      else await handleVariable(k.fam, k.t);
    } catch (e) {
      failed++;
      add(k.fam, k.t, (k.t.target && (k.t.target.name || k.t.target.style)) || '', 'failed', msg(e));
    }
    if ((i + 1) % BATCH === 0) { post({ progress: { done: i + 1, total: tasks.length } }); await tick(); }
  }
  try { flushRegistry(); } catch (e) { say('registry not saved: ' + msg(e)); }
  post({ progress: { done: Math.min(i, tasks.length), total: tasks.length } });
  const sum = summarize(ITEMS);
  const out = {
    tool: 'figma-lift-tokens', mode: DRY ? 'dry-run' : 'apply', generated: new Date().toISOString(), file: figma.root.name,
    cancelled: cancelled, tokensProcessed: Math.min(i, tasks.length), tokensTotal: tasks.length, writes: writes.count,
    counts: sum.byStatus, byFamily: sum.byFamily, failures: ITEMS.filter((x) => x.status === 'failed').length,
    conflicts: ITEMS.filter((x) => x.status === 'conflict'), items: ITEMS,
  };
  post({ result: { action: mode, json: JSON.stringify(out, null, 1), counts: sum.byStatus, byFamily: sum.byFamily, cancelled: cancelled, failures: out.failures, conflicts: out.conflicts.length } });
  return out;
}

// ---------- inventory ----------
const serial = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'symbol' ? 'mixed' : v)));
function pageOf(n) { let p = n; while (p && p.type !== 'PAGE') p = p.parent; return p ? p.name : ''; }
function paintKey(p) {
  if (p.visible === false) return null;
  if (p.type === 'SOLID') return 'c:' + hex2(p.color.r).toLowerCase() + hex2(p.color.g).toLowerCase() + hex2(p.color.b).toLowerCase() + '@' + Math.round((p.opacity === undefined ? 1 : p.opacity) * 100);
  if (p.type === 'IMAGE') return 'img';
  return 'grad';
}
const VECTOR_TYPES = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, LINE: 1, POLYGON: 1, ELLIPSE: 1 };
function fpType(n) {
  if (n.type === 'TEXT') return 'text';
  if (VECTOR_TYPES[n.type]) return 'svg';
  if (n.type === 'RECTANGLE' && Array.isArray(n.fills) && n.fills.some((f) => f.type === 'IMAGE' && f.visible !== false)) return 'img';
  return 'frame';
}
const SIZING = { FIXED: 'F', HUG: 'H', FILL: 'L' };
function fingerprint(n, depth) {
  const t = fpType(n), o = { t: t };
  if (t === 'frame') {
    const lm = n.layoutMode;
    o.k = lm === 'HORIZONTAL' ? 'H' : lm === 'VERTICAL' ? 'V' : lm === 'GRID' ? 'G' : lm === 'WRAP' ? 'W' : 'N';
    try { o.s = [SIZING[n.layoutSizingHorizontal] || 'F', SIZING[n.layoutSizingVertical] || 'F']; } catch (e) { o.s = ['F', 'F']; }
  }
  if (Array.isArray(n.fills)) { const f = n.fills.map(paintKey).filter(Boolean); if (f.length) o.fills = f; }
  if (t === 'frame') {
    if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) o.radius = n.cornerRadius;
    o.h = Math.round(n.height);
    if (n.layoutMode && n.layoutMode !== 'NONE') {
      const pad = [n.paddingTop || 0, n.paddingRight || 0, n.paddingBottom || 0, n.paddingLeft || 0];
      if (pad.some((x) => x)) o.pad = pad;
      if (n.itemSpacing) o.gap = n.itemSpacing;
    }
    const kids = [];
    if (depth < FP_MAX_DEPTH && n.children) for (const c of n.children) { if (c.visible === false) continue; if (kids.length >= FP_MAX_KIDS) break; kids.push(fingerprint(c, depth + 1)); }
    o.kids = kids;
  }
  return o;
}
function stripProp(name) { return name.replace(/#\d+:\d+$/, ''); }
function propsOf(n) {
  const out = {};
  let defs = {};
  try { defs = n.componentPropertyDefinitions || {}; } catch (e) { defs = {}; }
  for (const k of Object.keys(defs)) {
    const d = defs[k], o = { type: d.type };
    if (d.defaultValue !== undefined) o.defaultValue = d.defaultValue;
    if (d.variantOptions) o.variantOptions = d.variantOptions.slice();
    out[stripProp(k)] = o;
  }
  return out;
}
function geomHash(n) {
  let s = '';
  const walk = (x) => {
    if (x.vectorPaths) s += JSON.stringify(x.vectorPaths.map((p) => p.data));
    else if (x.fillGeometry) s += JSON.stringify(x.fillGeometry.map((p) => p.data));
    if (x.children) for (const c of x.children) walk(c);
  };
  walk(n);
  return s ? hash10(s) : undefined;
}
function onlyVectors(n) {
  if (!n.children || !n.children.length) return VECTOR_TYPES[n.type] === 1 || n.type === 'RECTANGLE';
  return n.children.every((c) => (c.children && c.children.length ? onlyVectors(c) : VECTOR_TYPES[c.type] === 1 || c.type === 'RECTANGLE'));
}
const isIcon = (n) => n.type === 'COMPONENT' && n.width <= ICON_MAX_SIZE && n.height <= ICON_MAX_SIZE && n.children && n.children.length > 0 && onlyVectors(n);
async function runInventory() {
  DRY = true; // inventory is read-only
  figma.skipInvisibleInstanceChildren = true;
  ITEMS = [];
  await buildIndexForInventory();
  const inv = { version: 1, file: figma.root.name, generated: new Date().toISOString(), collections: [], variables: [], paintStyles: [], textStyles: [], effectStyles: [], components: [], icons: [] };
  const fails = [];
  const guard = (label, fn) => { try { return fn(); } catch (e) { fails.push(label + ': ' + msg(e)); return undefined; } };
  for (const c of IDX.collById.values()) inv.collections.push({ id: c.id, name: c.name, modes: c.modes.map((m) => ({ id: m.modeId, name: m.name })) });
  let n = 0;
  for (const v of IDX.varById.values()) {
    guard('variable ' + v.name, () => {
      const o = { id: v.id, key: v.key, name: v.name, collection: v.variableCollectionId, type: v.resolvedType, scopes: v.scopes ? v.scopes.slice() : [], valuesByMode: serial(v.valuesByMode) };
      const cs = v.codeSyntax && Object.keys(v.codeSyntax).length ? serial(v.codeSyntax) : null;
      if (cs) o.codeSyntax = cs;
      inv.variables.push(o);
    });
    if (++n % 300 === 0) { post({ progress: { done: n, total: IDX.varById.size } }); await tick(); if (cancelled) break; }
  }
  for (const s of await figma.getLocalPaintStylesAsync()) guard('paint style ' + s.name, () => inv.paintStyles.push({ id: s.id, key: s.key, name: s.name, paints: serial(s.paints) }));
  for (const s of IDX.textById.values()) guard('text style ' + s.name, () => inv.textStyles.push({ id: s.id, key: s.key, name: s.name, fontName: serial(s.fontName), fontSize: s.fontSize, lineHeight: serial(s.lineHeight), letterSpacing: serial(s.letterSpacing) }));
  for (const s of IDX.fxById.values()) guard('effect style ' + s.name, () => inv.effectStyles.push({ id: s.id, key: s.key, name: s.name, effects: serial(s.effects) }));
  say('Reading components on all pages (this loads every page)...');
  try { await figma.loadAllPagesAsync(); } catch (e) { fails.push('loadAllPagesAsync: ' + msg(e)); }
  let seen = 0;
  for (const page of figma.root.children) {
    if (cancelled) break;
    let nodes = [];
    try { nodes = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] }); } catch (e) { fails.push('page ' + page.name + ': ' + msg(e)); continue; }
    for (const c of nodes) {
      if (c.type === 'COMPONENT' && c.parent && c.parent.type === 'COMPONENT_SET') continue; // variants belong to their set
      guard('component ' + c.name, () => {
        if (isIcon(c)) { const ic = { id: c.id, key: c.key, name: c.name.replace(/^(icons?|ic)\//i, '') }; const g = geomHash(c); if (g) ic.geom = g; inv.icons.push(ic); return; }
        const o = { id: c.id, key: c.key, name: c.name, type: c.type, page: pageOf(c), props: propsOf(c) };
        if (c.type === 'COMPONENT_SET') {
          const vs = c.children.filter((x) => x.type === 'COMPONENT');
          o.variants = vs.map((x) => x.name);
          const fp = {};
          vs.slice(0, FP_MAX_VARIANTS).forEach((x) => { fp[x.name] = fingerprint(x, 0); });
          o.fingerprint = { variants: fp };
        } else o.fingerprint = fingerprint(c, 0);
        inv.components.push(o);
      });
      if (++seen % 40 === 0) { post({ progress: { done: seen, total: 0 } }); await tick(); }
    }
  }
  const counts = { collections: inv.collections.length, variables: inv.variables.length, paintStyles: inv.paintStyles.length, textStyles: inv.textStyles.length, effectStyles: inv.effectStyles.length, components: inv.components.length, icons: inv.icons.length, failures: fails.length };
  post({ result: { action: 'inventory', json: JSON.stringify(inv, null, 1), inventoryCounts: counts, failures: fails.length, failureList: fails.slice(0, 30), cancelled: cancelled } });
  return { inv: inv, counts: counts, fails: fails };
}
async function buildIndexForInventory() { await buildIndex(); }

// ---------- messages ----------
figma.ui.onmessage = async (m) => {
  if (!m) return;
  if (m.type === 'cancel') { cancelled = true; say('Cancel requested, stopping after the current item...'); return; }
  if (m.type !== 'run') return;
  if (running) { say('Already running.'); return; }
  running = true; cancelled = false;
  try {
    if (m.action === 'inventory') await runInventory();
    else if (m.action === 'dry' || m.action === 'apply') {
      if (!m.tokens || typeof m.tokens !== 'object') throw new Error('No tokens.json loaded.');
      await runTokens(m.action, m.tokens, m.opts);
    } else throw new Error('Unknown action ' + m.action);
  } catch (e) {
    say('ERROR: ' + msg(e));
    post({ result: { action: m.action, error: msg(e), cancelled: cancelled } });
  }
  running = false;
  post({ finished: true });
};
