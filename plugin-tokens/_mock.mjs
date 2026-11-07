// Mock-based dry run for plugin-tokens/code.js. Stubs `figma` just enough to exercise create / idempotence / conflict / registry /
// alias / cancel / failure paths against fixtures/ds/tokens.json and fixtures/ds/ds-inventory.json. It proves control flow and logic,
// NOT Figma behaviour (all API semantics come from this fake and from docs/VERIFY-DS-RESULTS.md).
// Run: node plugin-tokens/_mock.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SRC = fs.readFileSync(path.join(here, 'code.js'), 'utf8');
const TOKENS = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/ds/tokens.json'), 'utf8'));
const INV = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/ds/ds-inventory.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

function makeEnv({ seed, pluginData = true, fonts, failCreateName, cancelAfter } = {}) {
  let ids = 100;
  const posted = [];
  const log = { writes: 0 };
  const colls = [], vars = [], textStyles = [], fxStyles = [], paintStyles = [];
  const rootData = {};
  const mkData = () => {
    const d = {};
    return pluginData
      ? { _d: d, getSharedPluginData: (ns, k) => d[ns + '/' + k] || '', setSharedPluginData: (ns, k, v) => { log.writes++; d[ns + '/' + k] = v; } }
      : { _d: d };
  };
  const addColl = (id, name, modes) => { const c = { id, name, modes: modes.map((m) => ({ modeId: m.id, name: m.name })), renameMode(mid, n) { log.writes++; this.modes.find((m) => m.modeId === mid).name = n; } }; colls.push(c); return c; };
  const addVar = (o) => {
    const v = Object.assign({ scopes: ['ALL_SCOPES'], codeSyntax: {}, valuesByMode: {}, hiddenFromPublishing: false }, mkData(), o);
    v.setValueForMode = function (m, val) { log.writes++; this.valuesByMode[m] = val; };
    v.setVariableCodeSyntax = function (p, s) { log.writes++; this.codeSyntax[p] = s; };
    vars.push(v); return v;
  };
  if (seed) {
    for (const c of INV.collections) addColl(c.id, c.name, c.modes);
    for (const v of INV.variables) addVar({ id: v.id, key: v.key, name: v.name, variableCollectionId: v.collection, resolvedType: v.type, scopes: v.scopes.slice(), valuesByMode: clone(v.valuesByMode), codeSyntax: clone(v.codeSyntax || {}) });
    for (const s of INV.textStyles) textStyles.push(Object.assign(mkData(), clone(s)));
  }
  // component tree for the inventory test
  const comp = (type, name, extra) => Object.assign({ type, name, id: '3:' + (++ids), key: 'k' + ids, children: [], visible: true, fills: [], width: 100, height: 44, layoutMode: 'NONE', parent: null }, extra);
  const page = { type: 'PAGE', name: '00 Design System', children: [], findAllWithCriteria(c) { const out = []; const w = (n) => { if (c.types.includes(n.type)) out.push(n); (n.children || []).forEach(w); }; this.children.forEach(w); return out; } };
  const adopt = (p, k) => { k.parent = p; p.children.push(k); return k; };
  const solid = (r, g, b) => ({ type: 'SOLID', color: { r, g, b }, opacity: 1 });
  const mkVariant = (nm, fill) => { const f = comp('COMPONENT', nm, { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG', cornerRadius: 8, itemSpacing: 8, paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16, fills: [solid(0.1843, 0.4353, 0.9294)], height: 44 }); adopt(f, comp('TEXT', 'Label', { fills: [fill] })); return f; };
  const set = comp('COMPONENT_SET', 'Button', { componentPropertyDefinitions: { Style: { type: 'VARIANT', defaultValue: 'Accent', variantOptions: ['Accent', 'Neutral'] }, 'Show icon#1:2': { type: 'BOOLEAN', defaultValue: false } } });
  adopt(set, mkVariant('Style=Accent', solid(1, 1, 1))); adopt(set, mkVariant('Style=Neutral', solid(0.12, 0.14, 0.19)));
  adopt(page, set);
  adopt(page, comp('COMPONENT', 'Divider', { componentPropertyDefinitions: {}, layoutMode: 'NONE', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', height: 1, fills: [solid(0.8863, 0.898, 0.9176)] }));
  const bell = comp('COMPONENT', 'Icon/Bell', { width: 24, height: 24, componentPropertyDefinitions: {} });
  adopt(bell, comp('VECTOR', 'p', { vectorPaths: [{ data: 'M0 0L10 10' }] })); adopt(page, bell);

  const variables = {
    createVariableCollection(name) { log.writes++; const c = addColl('VariableCollectionId:' + (++ids), name, [{ id: 'm' + (++ids), name: 'Mode 1' }]); return c; },
    createVariable(name, coll, type) {
      log.writes++;
      if (!coll || typeof coll !== 'object') throw new Error('createVariable needs the collection object');
      if (failCreateName && name === failCreateName) throw new Error('injected failure');
      return addVar({ id: 'VariableID:' + (++ids), key: 'vk' + ids, name, variableCollectionId: coll.id, resolvedType: type });
    },
    createVariableAlias: (v) => ({ type: 'VARIABLE_ALIAS', id: v.id }),
    getVariableByIdAsync: async (id) => vars.find((v) => v.id === id) || null,
    getLocalVariablesAsync: async () => vars.slice(),
    getLocalVariableCollectionsAsync: async () => colls.slice(),
    setBoundVariableForEffect: (e, f, v) => Object.assign({}, e, { boundVariables: { [f]: { type: 'VARIABLE_ALIAS', id: v.id } } }),
  };
  const mkStyle = (arr, prefix) => { log.writes++; const s = Object.assign(mkData(), { id: prefix + (++ids), key: 'sk' + ids, name: 'Style' }); arr.push(s); return s; };
  const handlers = {};
  const figma = {
    root: Object.assign({ name: 'Mock file', children: [page] }, (() => { const d = {}; return { getSharedPluginData: (ns, k) => d[ns + '/' + k] || '', setSharedPluginData: (ns, k, v) => { log.writes++; d[ns + '/' + k] = v; }, _d: d }; })()),
    variables,
    ui: { postMessage: (m) => { posted.push(m); if (m.progress && cancelAfter && !handlers.fired && m.progress.done >= cancelAfter && handlers.msg && (handlers.fired = true)) handlers.msg({ type: 'cancel' }); }, set onmessage(fn) { handlers.msg = fn; }, get onmessage() { return handlers.msg; } },
    showUI() {}, skipInvisibleInstanceChildren: false,
    createTextStyle: () => mkStyle(textStyles, 'S:t'), createEffectStyle: () => mkStyle(fxStyles, 'S:e'),
    getLocalTextStylesAsync: async () => textStyles.slice(), getLocalEffectStylesAsync: async () => fxStyles.slice(), getLocalPaintStylesAsync: async () => paintStyles.slice(),
    loadAllPagesAsync: async () => {},
    async loadFontAsync(f) { if (fonts && !(fonts[f.family] && fonts[f.family].includes(f.style))) throw new Error('font not available ' + f.family + ' ' + f.style); },
    async listAvailableFontsAsync() {
      const f = fonts || { Inter: ['Regular', 'Medium', 'SemiBold', 'Bold'] };
      return Object.keys(f).flatMap((fam) => f[fam].map((style) => ({ fontName: { family: fam, style } })));
    },
  };
  const ctx = { figma, __html__: '', console, setTimeout, clearTimeout, Date, JSON, Promise, Math };
  vm.runInNewContext(SRC, ctx, { filename: 'plugin-tokens/code.js' });
  return { figma, posted, log, colls, vars, textStyles, fxStyles, page, handlers };
}

async function run(env, action, tokens, opts) {
  const before = env.posted.length;
  const done = new Promise((resolve) => {
    const iv = setInterval(() => { if (env.posted.slice(before).some((m) => m.finished)) { clearInterval(iv); resolve(); } }, 2);
  });
  await env.handlers.msg({ type: 'run', action, tokens, opts });
  await done;
  const res = env.posted.slice(before).filter((m) => m.result).pop().result;
  return Object.assign({ data: res.json ? JSON.parse(res.json) : null }, res);
}

let fails = 0;
const check = (c, m) => { if (c) console.log('  ok: ' + m); else { fails++; console.log('  FAIL: ' + m); } };
const byKeyRole = (data, key, role) => data.items.find((i) => i.key === key && (role === undefined || i.role === role));
const section = (s) => console.log('\n== ' + s);

// 1. dry run on a file seeded from the inventory fixture
section('1. dry run against the seeded file');
{
  const env = makeEnv({ seed: true });
  const writesBefore = env.log.writes;
  const r = await run(env, 'dry', clone(TOKENS));
  check(env.log.writes === writesBefore && r.data.writes === 0, 'dry run performed no writes (' + r.data.writes + ')');
  check(!r.error, 'no error');
  console.log('  counts', JSON.stringify(r.counts));
  check(byKeyRole(r.data, 'c:1f2430@100', 'text').status === 'exists', 'bound text/primary exists (found by id)');
  check(byKeyRole(r.data, 'c:6b7280@100', 'icon').status === 'would create', 'icon/dim would create');
  check(byKeyRole(r.data, 'c:e8ebf0@100', 'fill').status === 'review', 'ambiguous bg/muted is review, not created');
  check(byKeyRole(r.data, 'sp:24').status === 'would create', 'spacing/6 would create');
  check(byKeyRole(r.data, 'sz:h44').status === 'would create', 'size/control would create');
  check(byKeyRole(r.data, 'r:10').status === 'skipped' && byKeyRole(r.data, 'c:000000@40').status === 'skipped', 'off-scale and skip stay skipped');
  check(byKeyRole(r.data, 't:Inter/14/400/20/0').status === 'exists', 'existing text style matches (px line height, PERCENT spacing)');
  check(byKeyRole(r.data, 't:Inter/24/700/32/0').status === 'would create', 'text style would create');
  check(r.counts['would create'] === 8, 'would create total = 8 (got ' + r.counts['would create'] + ')');
  check(env.vars.length === INV.variables.length && env.textStyles.length === INV.textStyles.length, 'nothing was created in the file');
}

// 2. apply, then apply again -> nothing new
section('2. apply and idempotence (stamps readable on objects)');
{
  const env = makeEnv({ seed: true });
  const nVars = env.vars.length, nText = env.textStyles.length;
  const a = await run(env, 'apply', clone(TOKENS));
  console.log('  counts', JSON.stringify(a.counts));
  check(a.counts.created === 8, 'first apply created 8 (got ' + a.counts.created + ')');
  check(env.vars.length === nVars + 4 && env.textStyles.length === nText + 4, 'file grew by 4 variables and 4 text styles');
  const v = env.vars.find((x) => x.name === 'icon/dim');
  check(v && JSON.stringify(v.scopes) === '["SHAPE_FILL","STROKE_COLOR"]' && v.codeSyntax.WEB === 'colors.dim', 'icon/dim has explicit scopes and WEB code syntax');
  check(v && Object.keys(v.valuesByMode).length === 1, 'one mode written only');
  check(v._d['figmalift/tokenKey'] === 'c:6b7280@100' && v._d['figmalift/tokenRole'] === 'icon' && v._d['figmalift/tokensVer'], 'ownership stamped (tokenKey, tokenRole, tokensVer)');
  const ts = env.textStyles.find((x) => x.name === 'Text/Heading 24 Bold');
  check(ts && ts.letterSpacing.unit === 'PERCENT' && ts.lineHeight.unit === 'PIXELS' && ts.lineHeight.value === 32 && ts.fontName.style === 'Bold', 'text style: PIXELS line height, PERCENT spacing, Bold');
  const w0 = env.log.writes, n1 = env.vars.length;
  const b = await run(env, 'apply', clone(TOKENS));
  check(!b.counts.created && b.data.writes === 0 && env.log.writes === w0 && env.vars.length === n1, 'second apply created nothing and wrote nothing');
  check(b.counts.exists >= 20, 'second apply: everything created now "exists" (' + b.counts.exists + ')');
  // designer renames a created variable and a text style: re-run still finds them by key
  v.name = 'Icons/My renamed dim'; ts.name = 'Heading XL';
  const c = await run(env, 'apply', clone(TOKENS));
  check(!c.counts.created && env.vars.length === n1, 'renamed items found by tokenKey, nothing duplicated');
  check(byKeyRole(c.data, 'c:6b7280@100', 'icon').renamedTo === 'Color/Icons/My renamed dim', 'rename is reported');
  check(v.name === 'Icons/My renamed dim', 'designer name not overwritten');
}

// 3. registry path when Variable / Style have no plugin data API
section('3. idempotence through the root registry (no plugin data on variables/styles)');
{
  const env = makeEnv({ seed: true, pluginData: false });
  // pre-existing seeded items have no getSharedPluginData; the plugin must cope
  const a = await run(env, 'apply', clone(TOKENS));
  check(a.counts.created === 8, 'created 8 without plugin data API');
  const n = env.vars.length;
  env.vars.find((x) => x.name === 'icon/dim').name = 'renamed';
  const b = await run(env, 'apply', clone(TOKENS));
  check(!b.counts.created && env.vars.length === n, 'second apply creates nothing, rename survived via registry');
}

// 4. conflicts
section('4. conflicts keep the designer value');
{
  const env = makeEnv({ seed: true });
  env.vars.find((x) => x.name === 'radius/md').valuesByMode['1:1'] = 9;
  env.vars.find((x) => x.name === 'bg/accent').valuesByMode['1:0'] = { r: 1, g: 0, b: 0, a: 1 };
  env.textStyles[0].fontSize = 15;
  const r = await run(env, 'apply', clone(TOKENS));
  check(byKeyRole(r.data, 'r:8').status === 'conflict', 'radius value differs: conflict');
  check(byKeyRole(r.data, 'c:2f6fed@100', 'fill').status === 'conflict', 'colour differs: conflict');
  check(byKeyRole(r.data, 't:Inter/14/400/20/0').status === 'conflict', 'text style size differs: conflict');
  check(env.vars.find((x) => x.name === 'radius/md').valuesByMode['1:1'] === 9 && env.textStyles[0].fontSize === 15, 'values untouched');
  check(r.data.conflicts.length === 3 && r.conflicts === 3, 'conflict report lists 3');
}

// 5. empty file: collections, bound-but-missing, aliases from Primitives
section('5. empty file creates collections; Primitives alias');
{
  const env = makeEnv({ seed: false });
  const t = clone(TOKENS);
  t.colors.push({ key: 'c:ffffff@100', role: 'fill', hex: '#FFFFFF', a: 1, count: 5, screens: 3, tailwind: 'white', status: 'create', target: { collection: 'Primitives', name: 'white', type: 'COLOR', scopes: [] } });
  const dry = await run(env, 'dry', t);
  check(dry.data.items.some((i) => i.family === 'collection' && i.name === 'Primitives'), 'dry run announces new collection Primitives');
  const textOnAccent = dry.data.items.find((i) => i.name === 'text/on-accent');
  check(textOnAccent.detail.indexOf('alias of Primitives/white') >= 0, 'dry run predicts the alias to a primitive created in the same run');
  const a = await run(env, 'apply', t);
  check(env.colls.map((c) => c.name).sort().join() === 'Color,Layout,Primitives', 'collections Color, Layout, Primitives created');
  check(env.colls.every((c) => c.modes.length === 1 && c.modes[0].name === 'Value'), 'each new collection has exactly one mode');
  const sem = env.vars.find((x) => x.name === 'text/on-accent'), prim = env.vars.find((x) => x.name === 'white');
  const mid = env.colls.find((c) => c.id === sem.variableCollectionId).modes[0].modeId;
  check(sem.valuesByMode[mid].type === 'VARIABLE_ALIAS' && sem.valuesByMode[mid].id === prim.id, 'semantic variable is an alias of the primitive');
  check(prim.hiddenFromPublishing === true && prim.scopes.length === 0, 'primitive hidden with empty scopes');
  check(a.counts.created > 10 && !a.failures, 'bound-but-missing tokens were created (' + a.counts.created + ')');
  const n = env.vars.length;
  const b = await run(env, 'apply', t);
  check(!b.counts.created && env.vars.length === n, 'second apply creates nothing');
}

// 6. text fonts and effect styles with colour binding
section('6. fonts fallback and effect styles');
{
  const fonts = { Inter: ['Regular', 'Medium', 'SemiBold', 'Bold'], 'Space Grotesk': ['Regular', 'Medium', 'Bold'] };
  const env = makeEnv({ seed: true, fonts });
  const t = clone(TOKENS);
  t.textStyles.push(
    { key: 't:Space Grotesk/20/600/28/-0.025', count: 5, screens: 3, status: 'create', target: { name: 'Display/Heading 20 SemiBold' } },
    { key: 't:Vazirmatn/14/400/22/0', count: 5, screens: 3, status: 'create', target: { name: 'Text/Body FA' } });
  t.colors.push({ key: 'c:000000@20', role: 'shadow', hex: '#000000', a: 0.2, count: 3, screens: 2, status: 'create', target: { collection: 'Color', name: 'effect/shadow', type: 'COLOR', scopes: ['EFFECT_COLOR'] } });
  t.colors = t.colors.filter((c) => !(c.key === 'c:000000@20' && c.status === 'skip'));
  t.effects = [{ key: 'e:0,8,24,0,000000@20|i0,1,0,0,000000@20', count: 3, screens: 2, status: 'create', target: { style: 'Shadow/md' } }];
  const a = await run(env, 'apply', t);
  const sg = env.textStyles.find((x) => x.name === 'Display/Heading 20 SemiBold');
  check(sg && sg.fontName.family === 'Space Grotesk' && sg.fontName.style === 'Bold', 'Space Grotesk SemiBold maps to Bold: ' + (sg && sg.fontName.style));
  check(sg && sg.letterSpacing.value === -2.5 && sg.letterSpacing.unit === 'PERCENT', 'letter spacing -0.025em written as -2.5 PERCENT');
  const fa = env.textStyles.find((x) => x.name === 'Text/Body FA');
  check(fa && fa.fontName.family === 'Inter', 'missing Vazirmatn falls back to Inter');
  check(byKeyRole(a.data, 't:Vazirmatn/14/400/22/0').detail.indexOf('not installed') >= 0, 'fallback is reported');
  const fx = env.fxStyles.find((x) => x.name === 'Shadow/md');
  check(fx && fx.effects.length === 2 && fx.effects[0].type === 'DROP_SHADOW' && fx.effects[1].type === 'INNER_SHADOW', 'effect style has drop + inner shadow');
  check(fx && fx.effects[0].boundVariables && fx.effects[0].boundVariables.color, 'effect colour bound to variable');
  const n = env.fxStyles.length, w = env.log.writes;
  const b = await run(env, 'apply', t);
  check(!b.counts.created && env.fxStyles.length === n && env.log.writes === w, 'effect/text re-run creates nothing');
}

// 7. failure isolation and cancel
section('7. per-item failure and cancel');
{
  const env = makeEnv({ seed: true, failCreateName: 'spacing/6' });
  const r = await run(env, 'apply', clone(TOKENS));
  check(r.failures === 1 && r.counts.failed === 1, 'one injected failure counted');
  check(r.counts.created === 7, 'other items still created (' + r.counts.created + ')');
  const env2 = makeEnv({ seed: true, cancelAfter: 25 });
  const t = clone(TOKENS);
  for (let i = 0; i < 200; i++) t.spacing.push({ key: 'sp:' + (1000 + i), count: 9, screens: 3, status: 'create', target: { collection: 'Layout', name: 'spacing/x' + i, type: 'FLOAT' } });
  const c = await run(env2, 'apply', t);
  check(c.cancelled === true && c.data.tokensProcessed < c.data.tokensTotal, 'cancel stops early (' + c.data.tokensProcessed + '/' + c.data.tokensTotal + ')');
  const n = env2.vars.length;
  const d = await run(env2, 'apply', t);
  check(env2.vars.length > n && d.counts.created > 0, 'resuming after cancel creates the rest');
  const e = await run(env2, 'apply', t);
  check(!e.counts.created, 'and then nothing more');
}

// 8. inventory against the schema
section('8. export inventory');
{
  const env = makeEnv({ seed: true });
  env.textStyles.push(Object.assign({ id: 'S:t2', key: 'k2', name: 'x', fontName: { family: 'Inter', style: 'Bold' }, fontSize: 20, lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 } }));
  const r = await run(env, 'inventory');
  const inv = r.data;
  check(inv.collections.length === 2 && inv.variables.length === INV.variables.length, 'collections and variables exported');
  const v = inv.variables.find((x) => x.name === 'bg/page');
  check(v.valuesByMode['1:0'].r === 0.9608 && v.codeSyntax.WEB === 'colors.page', 'valuesByMode keyed by mode id, codeSyntax kept');
  check(inv.components.length === 2 && inv.icons.length === 1 && inv.icons[0].name === 'Bell' && inv.icons[0].geom, 'components and icon found, icon split out');
  const btn = inv.components.find((c) => c.name === 'Button');
  check(btn.type === 'COMPONENT_SET' && btn.variants.length === 2 && btn.props['Show icon'] && btn.props.Style.variantOptions.length === 2, 'component set props (suffix stripped) and variants');
  const fp = btn.fingerprint.variants['Style=Accent'];
  check(fp.t === 'frame' && fp.k === 'H' && fp.s.join() === 'H,H' && fp.radius === 8 && fp.h === 44 && fp.pad.join() === '12,16,12,16' && fp.gap === 8 && fp.kids[0].fills[0] === 'c:ffffff@100', 'fingerprint matches the fixture shape');
  try {
    const { validate, formatErrors } = await import(pathToFileURL(path.join(root, 'tools/ds/common/validate.mjs')).href);
    const res = validate('inventory', inv);
    check(res.valid !== false && (res.errors || []).length === 0, 'inventory validates against inventory.schema.json' + (res.errors && res.errors.length ? '\n' + formatErrors(res) : ''));
  } catch (e) { console.log('  (schema validator not importable: ' + e.message + ')'); }
}

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
