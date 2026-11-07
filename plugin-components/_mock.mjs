// Mock-based run of plugin-components/code.js against fixtures/ds/_library.json.
// Catches JS errors, API misuse the typings document (FILL/HUG outside auto-layout, properties added after combine, holes, createInstance on a set,
// setProperties with unknown keys) and logic slips (idempotence, supersede, fallback, ladder). IT IS NOT FIGMA: no layout engine, no fonts, no rendering.
// usage: node plugin-components/_mock.mjs
import fs from 'fs'; import vm from 'vm'; import path from 'path'; import assert from 'assert';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(here, 'code.js'), 'utf8');
const LIB = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'ds', '_library.json'), 'utf8'));
const AUTO = ['HORIZONTAL', 'VERTICAL', 'GRID'];

function makeFigma(opt = {}) {
  let idc = 0; const violations = []; const stats = { creates: 0 };
  const viol = (m) => { violations.push(m); throw new Error('MOCK violation: ' + m); };
  const byId = new Map();
  function mk(type) {
    stats.creates++;
    const n = { type, id: type[0] + (++idc) + ':0', name: type, children: [], parent: null, x: 0, y: 0, visible: true, removed: false, fills: [], strokes: [], effects: [], _pd: {}, layoutMode: 'NONE', characters: '', description: '', opacity: 1, strokeWeight: 1, width: 100, height: 100 };
    byId.set(n.id, n);
    n.resize = (w, h) => { if (!(w >= 0.01 && h >= 0.01)) throw new Error('resize: size must be >= 0.01'); n.width = w; n.height = h; };
    n.resizeWithoutConstraints = n.resize;
    n.setGridChildPosition = (r, c) => { n._cell = [r, c]; }; n.gridRowAnchorIndex = 0; n.gridColumnAnchorIndex = 0;
    // grid API (sizes arrays follow the counts, like Figma)
    n._cols = []; n._rows = [];
    Object.defineProperty(n, 'gridColumnCount', { get() { return n._cols.length; }, set(v) { while (n._cols.length < v) n._cols.push({ type: 'FLEX', value: 1 }); n._cols.length = v; } });
    Object.defineProperty(n, 'gridRowCount', { get() { return n._rows.length; }, set(v) { while (n._rows.length < v) n._rows.push({ type: 'FLEX', value: 1 }); n._rows.length = v; } });
    Object.defineProperty(n, 'gridColumnSizes', { get() { return n._cols; } });
    Object.defineProperty(n, 'gridRowSizes', { get() { return n._rows; } });
    n.appendChild = (c) => { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); if (['TEXT', 'VECTOR'].includes(n.type)) viol('appendChild on ' + n.type); c.parent = n; n.children.push(c); };
    n.remove = () => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; n.removed = true; };
    n.setSharedPluginData = (ns, k, v) => { if (v === '') delete n._pd[ns + '/' + k]; else n._pd[ns + '/' + k] = v; };
    n.getSharedPluginData = (ns, k) => n._pd[ns + '/' + k] || '';
    const sizingSet = (axis) => (v) => {
      const p = n.parent, selfAuto = AUTO.includes(n.layoutMode), parentAuto = p && AUTO.includes(p.layoutMode);
      if (v === 'FILL' && !parentAuto) viol('FILL outside auto-layout parent: ' + n.name);
      if (v === 'HUG' && !(selfAuto || n.type === 'TEXT')) viol('HUG on non auto-layout ' + n.type + ' ' + n.name);
      n['_ls' + axis] = v;
    };
    Object.defineProperty(n, 'layoutSizingHorizontal', { get() { return n._lsH || 'FIXED'; }, set: sizingSet('H') });
    Object.defineProperty(n, 'layoutSizingVertical', { get() { return n._lsV || 'FIXED'; }, set: sizingSet('V') });
    n.findAllWithCriteria = (c) => {
      const out = []; const walk = (x) => { for (const ch of x.children) { if ((!c.types || c.types.includes(ch.type)) && (!c.sharedPluginData || c.sharedPluginData.keys.every((k) => ch.getSharedPluginData(c.sharedPluginData.namespace, k)))) out.push(ch); walk(ch); } }; walk(n); return out;
    };
    return n;
  }
  const figma = {
    ui: { postMessage: (m) => figma._msgs.push(m), onmessage: null }, _msgs: [], _viol: violations, _stats: stats,
    showUI() {}, viewport: { scrollAndZoomIntoView() {} },
    root: { children: [] }, currentPage: null,
    async loadAllPagesAsync() {}, async setCurrentPageAsync(p) { figma.currentPage = p; },
    createPage() { if (opt.pageLimit) throw new Error('Cannot create more pages on this plan'); const p = mk('PAGE'); p.name = 'Page'; figma.root.children.push(p); p.parent = figma.root; return p; },
    createFrame() { return mk('FRAME'); }, createRectangle() { return mk('RECTANGLE'); }, createSection() { return mk('SECTION'); },
    createText() { const t = mk('TEXT'); t.textAutoResize = 'NONE'; t.setRangeFontName = t.setRangeFontSize = t.setRangeFills = t.setRangeTextDecoration = () => {}; return t; },
    createNodeFromSvg(svg) {
      if (/BADSVG/.test(svg)) throw new Error('svg parse error');
      const f = mk('FRAME'); f.name = 'svg'; f.resize(24, 24); const v = mk('VECTOR'); v.parent = f; f.children.push(v); v.strokes = [{ type: 'SOLID' }]; return f;
    },
    createComponentFromNode(node) {
      const c = mk('COMPONENT'); Object.assign(c, { name: node.name, x: node.x, y: node.y, fills: node.fills, layoutMode: node.layoutMode, _lsH: node._lsH, _lsV: node._lsV });
      c.width = node.width + (opt.drift || 0); c.height = node.height;
      c._defs = {}; c._propN = 0;
      c.addComponentProperty = (name, type, dv) => {
        if (c.parent && c.parent.type === 'COMPONENT_SET') viol('addComponentProperty on a variant member of a set (must be before combine)');
        if (!['TEXT', 'BOOLEAN', 'INSTANCE_SWAP'].includes(type)) viol('bad property type ' + type);
        const key = name + '#' + (++c._propN) + ':0'; c._defs[key] = { type, defaultValue: dv }; return key;
      };
      Object.defineProperty(c, 'componentPropertyDefinitions', { get() { return c._defs; } });
      c.createInstance = () => instanceOf(c);
      const p = node.parent; if (p) { const i = p.children.indexOf(node); node.parent = null; p.children[i] = c; c.parent = p; }
      for (const ch of node.children) { ch.parent = c; c.children.push(ch); }
      node.children = []; node.removed = true;
      return c;
    },
    combineAsVariants(comps, parent) {
      if (!comps.length) throw new Error('empty');
      const names = new Set();
      for (const c of comps) { if (c.type !== 'COMPONENT') viol('combine: not a component'); if (names.has(c.name)) viol('combine: duplicate variant name ' + c.name); names.add(c.name); }
      const s = mk('COMPONENT_SET'); s.name = 'Set'; s._defs = {};
      parent.appendChild(s);
      for (const c of comps) { c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = s; s.children.push(c); c.x = 0; c.y = 0; for (const [k, d] of Object.entries(c._defs)) { const base = k.replace(/#.*/, ''); if (!Object.keys(s._defs).some((q) => q.replace(/#.*/, '') === base)) s._defs[k] = d; } }
      Object.defineProperty(s, 'componentPropertyDefinitions', { get() { return s._defs; } });
      Object.defineProperty(s, 'defaultVariant', { get() { return s.children[0]; } });
      s.createInstance = () => viol('createInstance on a COMPONENT_SET');
      return s;
    },
    async listAvailableFontsAsync() { return [{ fontName: { family: 'Inter', style: 'Regular' } }, { fontName: { family: 'Inter', style: 'Medium' } }, { fontName: { family: 'Inter', style: 'SemiBold' } }]; },
    async loadFontAsync() {}, async getNodeByIdAsync(id) { return byId.get(id) || null; },
  };
  function instanceOf(comp) {
    const inst = mk('INSTANCE'); inst.name = comp.name; inst.width = comp.width; inst.height = comp.height; inst.layoutMode = comp.layoutMode; inst.mainComponent = comp;
    const defs = Object.assign({}, comp._defs || {}, comp.parent && comp.parent._defs ? comp.parent._defs : {});
    inst.componentProperties = {}; for (const [k, d] of Object.entries(defs)) inst.componentProperties[k] = { type: d.type, value: d.defaultValue };
    inst.setProperties = (o) => { for (const k of Object.keys(o)) { if (!(k in inst.componentProperties)) throw new Error('setProperties: unknown property ' + k); inst.componentProperties[k].value = o[k]; } };
    const clone = (src, par) => { for (const ch of src.children) { const c = mk(ch.type === 'COMPONENT' ? 'FRAME' : ch.type); Object.assign(c, { name: ch.name, width: ch.width, height: ch.height, strokes: ch.strokes ? [...ch.strokes] : [], strokeWeight: ch.strokeWeight, visible: ch.visible }); c.parent = par; par.children.push(c); clone(ch, c); } };
    clone(comp, inst);
    return inst;
  }
  const page = mk('PAGE'); page.name = 'Page 1'; page.parent = figma.root; figma.root.children.push(page); figma.currentPage = page;
  return figma;
}
function load(figma) {
  const ctx = vm.createContext({ figma, __html__: '<html>', setTimeout, console });
  vm.runInContext(CODE, ctx, { filename: 'code.js' });
  return ctx;
}
async function runPlugin(figma, mode, lib, opts) {
  figma._msgs.length = 0;
  await figma.ui.onmessage({ type: 'run', mode, library: JSON.stringify(lib), opts: Object.assign({ verifyLayout: false }, opts || {}) });
  const sum = figma._msgs.find((m) => m.summary); const rep = figma._msgs.find((m) => m.report);
  return { summary: sum && sum.summary, report: rep && rep.report, logs: figma._msgs.filter((m) => m.log).map((m) => m.log).join('\n') };
}
const liftPage = (f) => f.root.children.find((p) => p.name === 'Lift Components');
const allNodes = (n, out = []) => { for (const c of n.children) { out.push(c); allNodes(c, out); } return out; };
const tagged = (f) => allNodes(liftPage(f)).filter((n) => n.getSharedPluginData('figmalift', 'cmp'));
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ok  ' + m); };
// stress mode: FL_STRESS_LIB=<path to a real _library.json> node plugin-components/_mock.mjs   (runs only this block)
if (process.env.FL_STRESS_LIB) {
  const big = JSON.parse(fs.readFileSync(process.env.FL_STRESS_LIB, 'utf8'));
  const f = makeFigma(); load(f);
  const t0 = Date.now();
  const r = await runPlugin(f, 'apply', big);
  console.log('stress: components ' + big.components.length + ', icons ' + big.icons.length + ', summary ' + JSON.stringify(r.summary).slice(0, 600) + ', ' + (Date.now() - t0) + ' ms, violations ' + f._viol.length);
  if (f._viol.length) console.log(f._viol.slice(0, 5));
  const again = await runPlugin(f, 'apply', big);
  console.log('stress re-run created ' + again.summary.created + ' (expect 0)');
  process.exit(f._viol.length || r.summary.failed ? 1 : 0);
}

{
  console.log('1. dry run');
  const f = makeFigma(); load(f);
  const before = f._stats.creates;
  const r = await runPlugin(f, 'dry', LIB);
  ok(f._stats.creates === before, 'dry run created no nodes');
  ok(!liftPage(f), 'dry run did not create the page');
  ok(/CREATE cmp_button_8ff3/.test(r.report) && /Icons: create 4/.test(r.report), 'dry report lists creates');
  ok(/page "Lift Components" missing/.test(r.report), 'dry report says page would be created');
}
{
  console.log('2. apply / idempotence');
  const f = makeFigma(); load(f);
  let r = await runPlugin(f, 'apply', LIB);
  ok(!!liftPage(f), 'page created');
  ok(r.summary.created === 7 && r.summary.failed === 0, 'created 7 (4 icons + 3 components), failed 0: ' + JSON.stringify([r.summary.created, r.summary.failed, r.summary.errors, r.summary.flags]));
  ok(r.summary.sets === 1, 'one component set (Button)');
  const t = tagged(f); const byCmp = Object.fromEntries(t.map((n) => [n.getSharedPluginData('figmalift', 'cmp'), n]));
  ok(t.length === 7 && Object.keys(byCmp).length === 7, 'registry has 7 tagged masters');
  const button = byCmp['cmp_button_8ff3'];
  ok(button.type === 'COMPONENT_SET' && button.children.length === 3, 'Button is a set of 3 members (no hole requested)');
  ok(button.children.map((c) => c.name).sort().join('|') === ['Type=Primary, State=Default', 'Type=Primary, State=Disabled', 'Type=Secondary, State=Default'].sort().join('|'), 'variant names Prop=Value');
  const defs = Object.keys(button.componentPropertyDefinitions).map((k) => k.replace(/#.*/, '')).sort();
  ok(defs.join(',') === 'Icon,Label,Show icon', 'set inherits TEXT, BOOLEAN, INSTANCE_SWAP by name: ' + defs);
  const icon0 = button.children[0].children[0];
  ok(icon0.type === 'INSTANCE' && icon0.visible === false, 'icon slot is an instance, hidden by default (Show icon=false)');
  ok(new Set(button.children.map((c) => c.x + ',' + c.y)).size === 3, 'variants laid out on a grid (not stacked)');
  const card = byCmp['cmp_card_b12b'];
  const nested = allNodes(card).filter((n) => n.type === 'INSTANCE' && n.mainComponent && /^Type=/.test(n.mainComponent.name));
  ok(card.type === 'COMPONENT' && nested.length === 2, 'Card holds 2 nested Button instances');
  ok(/^\[REVIEW\]/.test(card.description) && card.getSharedPluginData('figmalift', 'band') === 'review', 'review band tagged in description and plugin data');
  ok(/auto/.test(button.description) && !/\[REVIEW\]/.test(button.description), 'auto band description');
  const li = byCmp['cmp_list-item_151e'];
  ok(Object.keys(li.componentPropertyDefinitions).length === 2, 'List Item has Icon swap + Label text');
  ok(allNodes(li).some((n) => n.type === 'INSTANCE' && n.mainComponent && n.mainComponent.name.startsWith('Icon/')), 'icons are instances of Icon/* components');
  const groups = liftPage(f).children.map((c) => c.name).sort().join(',');
  ok(groups === 'Buttons,Cards,Icons,Lists' && liftPage(f).children.every((c) => c.type === 'SECTION'), 'one Section per group: ' + groups);
  ok(f._viol.length === 0, 'no API violations recorded');
  const nodeCount = allNodes(liftPage(f)).length, creates = f._stats.creates;

  console.log('3. second apply creates nothing');
  r = await runPlugin(f, 'apply', LIB);
  ok(r.summary.created === 0 && r.summary.exists === 7 && r.summary.failed === 0, 'second run: created 0, exists 7');
  ok(f._stats.creates === creates && allNodes(liftPage(f)).length === nodeCount, 'no nodes created or removed');
  r = await runPlugin(f, 'dry', LIB);
  ok(/Icons: create 0, exist 4, changed 0/.test(r.report) && /Components: create 0, exist 3, changed 0/.test(r.report), 'dry run afterwards: everything exists');

  console.log('4. changed library entry -> supersede');
  const lib2 = JSON.parse(JSON.stringify(LIB)); const li2 = lib2.components.find((c) => c.id === 'cmp_list-item_151e'); li2.root.children[1].text = 'Changed copy'; li2.slots[1].default = 'Changed copy';
  r = await runPlugin(f, 'dry', lib2);
  ok(/Components: create 0, exist 2, changed 1/.test(r.report), 'dry run detects 1 changed component');
  r = await runPlugin(f, 'apply', lib2);
  ok(r.summary.created === 1 && r.summary.superseded === 1, 'apply creates the new master and supersedes the old');
  ok(tagged(f).filter((n) => n.getSharedPluginData('figmalift', 'cmp') === 'cmp_list-item_151e').length === 1, 'exactly one master keeps the tag');
  ok(allNodes(liftPage(f)).some((n) => /\(superseded \d{4}-\d\d-\d\d\)$/.test(n.name)), 'old master renamed (superseded <date>)');
  r = await runPlugin(f, 'apply', lib2);
  ok(r.summary.created === 0, 'run after supersede creates nothing');
  const ctx = load(f); const m = await vm.runInContext("findMaster('cmp_button_8ff3')", ctx);
  ok(m && m.type === 'COMPONENT_SET', 'findMaster returns the set');
  const pv = vm.runInContext('pickVariant', ctx);
  ok(pv(m, { Type: 'Primary', State: 'Disabled' }).name === 'Type=Primary, State=Disabled' && pv(m, { Type: 'Secondary', State: 'Disabled' }) === null, 'pickVariant: exact match, hole -> null');
}
{
  console.log('5. page-limit fallback');
  const f = makeFigma({ pageLimit: true }); load(f);
  const r = await runPlugin(f, 'apply', LIB);
  const sec = f.currentPage.children.find((c) => c.type === 'SECTION' && c.name === 'Lift Components');
  ok(!!sec && /FALLBACK/.test(r.logs) && r.summary.created === 7, 'Section fallback used and reported, 7 created');
  ok(sec.children.every((c) => c.type === 'FRAME'), 'groups are frames inside the section (sections cannot nest)');
  const r2 = await runPlugin(f, 'apply', LIB);
  ok(r2.summary.created === 0, 'fallback re-run idempotent');
}
{
  console.log('6. failure ladder');
  const bad = JSON.parse(JSON.stringify(LIB)); bad.icons[0].svg = bad.icons[0].svg.replace('<svg', '<svg data-x="BADSVG"');
  const f = makeFigma(); load(f);
  const r = await runPlugin(f, 'apply', bad);
  ok(r.summary.failed === 1 && r.summary.created === 6, 'broken icon fails alone (R4), the other 6 are created');
  ok(r.summary.r.R4 === 1 && r.summary.r.R3 >= 1, 'dependents fell back to plain svg (R3): ' + JSON.stringify(r.summary.r));
  ok(r.summary.errors.length >= 1 && /svg parse error/.test(r.summary.errors[0]), 'first error message reported');
  const r2 = await runPlugin(f, 'apply', LIB);
  ok(r2.summary.created === 1 && r2.summary.failed === 0, 'fixed library: only the missing icon is created on re-run');
  const noRoot = JSON.parse(JSON.stringify(LIB)); noRoot.components[2].root = null;
  const f2 = makeFigma(); load(f2);
  const r3 = await runPlugin(f2, 'apply', noRoot);
  ok(r3.summary.failed === 1 && r3.summary.created === 6, 'component with no root fails alone');
  const f3 = makeFigma({ drift: 5 }); load(f3);
  const fixedLib = JSON.parse(JSON.stringify(LIB)); fixedLib.components[2].root.ls.s = ['F', 'F'];
  const r4 = await runPlugin(f3, 'apply', fixedLib);
  ok(r4.summary.r.R2 >= 1 && r4.summary.failed === 0, 'R2 bounds fix runs: ' + JSON.stringify(r4.summary.r));
}
{
  console.log('7. cancel / review / cycle');
  const f = makeFigma(); load(f);
  const p = f.ui.onmessage({ type: 'run', mode: 'apply', library: JSON.stringify(LIB), opts: { verifyLayout: false } });
  f.ui.onmessage({ type: 'cancel' }); await p;
  const s = f._msgs.find((m) => m.summary).summary;
  ok(s.cancelled > 0 && s.created < 7, 'cancel stops between items (created ' + s.created + ', not processed ' + s.cancelled + ')');
  const r = await runPlugin(f, 'apply', LIB);
  ok(r.summary.created === 7 - s.created && r.summary.failed === 0, 'resume creates only the rest');
  const rv = await runPlugin(f, 'review', LIB);
  ok(/REVIEW REPORT: 1 review-band/.test(rv.report) && /Card/.test(rv.report) && /DS "Button"/.test(rv.report), 'review report lists Card and DS matches (report only)');
  const cyc = JSON.parse(JSON.stringify(LIB));
  cyc.components[2].root.children.push({ t: 'frame', name: 'x', x: 0, y: 0, w: 10, h: 10, cmp: { id: 'cmp_card_b12b' }, children: [] });
  cyc.components[1].root.children.push({ t: 'frame', name: 'y', x: 0, y: 0, w: 10, h: 10, cmp: { id: 'cmp_list-item_151e' }, children: [] });
  const f2 = makeFigma(); load(f2);
  const rc = await runPlugin(f2, 'apply', cyc);
  ok(rc.summary.failed === 0 && rc.summary.created === 7 && /cycle/i.test(rc.logs), 'dependency cycle broken, nothing fails');
}
console.log('\nALL ' + pass + ' CHECKS PASSED');
