// Runs plugin/code.js against a MOCKED Figma API. It catches JS errors, illegal API usage that the typings document
// (FILL outside auto-layout, HUG on a rectangle, resize after layoutSizing, text with FILL but WIDTH_AND_HEIGHT, grid calls in the wrong
// mode ...) and logic slips in the build order / fallback ladder. It contains a small auto-layout engine (layout-sim.mjs) so the plugin's
// verification and degradation paths really run. IT IS NOT FIGMA: real Figma will differ (text metrics, rounding, grid details).
// usage: node plugin-mock.mjs <file.figma.json> [bind] [--text-scale=1.04] [--no-layout] [--no-grid] [--quiet]
import fs from 'fs'; import vm from 'vm';
import { layoutBox } from './layout-sim.mjs';

const argv = process.argv.slice(2);
const flagv = (n, d) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const file = argv.find((a) => !a.startsWith('--') && a !== 'bind'), bind = argv.includes('bind');
const TEXT_SCALE = parseFloat(flagv('text-scale', '1'));
const NO_LAYOUT = argv.includes('--no-layout'), NO_GRID = argv.includes('--no-grid'), QUIET = argv.includes('--quiet');
const logs = [];
const violations = new Map();
const violate = (what) => violations.set(what, (violations.get(what) || 0) + 1);

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
// text metrics: Chrome-measured sizes by characters, scaled to emulate Figma's different shaping
const textList = [];
(function scan(n) { if (n.t === 'text') textList.push({ w: n.w, h: n.h, l: (n.ls && n.ls.tx && n.ls.tx.l) || (n.fixed ? 2 : 1) }); (n.children || []).forEach(scan); })({ children: data.frames });
let textSeq = 0;

let version = 1, idc = 0;
const created = [];
const AUTO = ['HORIZONTAL', 'VERTICAL', 'GRID'];
function mkNode(type) {
  const n = {
    type, id: 'n' + (++idc), children: [], parent: null, _w: 100, _h: 100, _x: 0, _y: 0, characters: '', fills: [], effects: [], strokes: [],
    _layoutMode: 'NONE', _sz: ['FIXED', 'FIXED'], constraints: { horizontal: 'MIN', vertical: 'MIN' }, _lay: null, _v: 0, _grid: { rows: [], cols: [] },
  };
  const bump = () => { version++; };
  const isAutoNode = () => n.type === 'FRAME' && AUTO.includes(n._layoutMode);
  const parentAuto = () => !!n.parent && n.parent.type === 'FRAME' && AUTO.includes(n.parent._layoutMode);
  n.resize = (w, h) => {
    if (!(w >= 0.01 && h >= 0.01)) throw new Error('resize: size must be >= 0.01');
    if (n.type === 'TEXT') {
      if (n.textAutoResize === 'WIDTH_AND_HEIGHT') { n.textAutoResize = 'NONE'; n._w = w; n._h = h; }
      else if (n.textAutoResize === 'HEIGHT') { n._w = w; } else { n._w = w; n._h = h; }
      n._sz[0] = 'FIXED'; if (n.textAutoResize === 'NONE') n._sz[1] = 'FIXED';
    } else { n._w = w; n._h = h; if (n._sz.includes('HUG') || n._sz.includes('FILL')) violate('resize() reset a HUG/FILL sizing mode'); n._sz = ['FIXED', 'FIXED']; }
    bump();
  };
  n.resizeWithoutConstraints = n.resize;
  const lay = (k) => { if (n._v !== version) relayout(n); return n._lay ? n._lay[k] : null; };
  Object.defineProperty(n, 'width', { get() { const v = lay('rw'); return v != null ? v : n._w; } });
  Object.defineProperty(n, 'height', { get() { const v = lay('rh'); return v != null ? v : n._h; } });
  Object.defineProperty(n, 'x', { get() { const v = lay('rx'); return v != null ? v : n._x; }, set(v) { n._x = v; bump(); } });
  Object.defineProperty(n, 'y', { get() { const v = lay('ry'); return v != null ? v : n._y; }, set(v) { n._y = v; bump(); } });
  Object.defineProperty(n, 'layoutMode', {
    get() { return n._layoutMode; },
    set(v) {
      if (n.type !== 'FRAME') throw new Error('layoutMode on ' + n.type);
      if (v === 'GRID' && NO_GRID) throw new Error('GRID not supported (mock --no-grid)');
      n._layoutMode = v; bump();
    },
  });
  Object.defineProperty(n, 'primaryAxisSizingMode', { get() { return n._sz[n._layoutMode === 'VERTICAL' ? 1 : 0] === 'HUG' ? 'AUTO' : 'FIXED'; }, set(v) { if (!['FIXED', 'AUTO'].includes(v)) throw new Error('bad primaryAxisSizingMode ' + v); if (!isAutoNode() || n._layoutMode === 'GRID') throw new Error('primaryAxisSizingMode needs HORIZONTAL/VERTICAL'); n._sz[n._layoutMode === 'VERTICAL' ? 1 : 0] = v === 'AUTO' ? 'HUG' : 'FIXED'; bump(); } });
  Object.defineProperty(n, 'counterAxisSizingMode', { get() { return n._sz[n._layoutMode === 'VERTICAL' ? 0 : 1] === 'HUG' ? 'AUTO' : 'FIXED'; }, set(v) { if (!['FIXED', 'AUTO'].includes(v)) throw new Error('bad counterAxisSizingMode ' + v); if (!isAutoNode() || n._layoutMode === 'GRID') throw new Error('counterAxisSizingMode needs HORIZONTAL/VERTICAL'); n._sz[n._layoutMode === 'VERTICAL' ? 0 : 1] = v === 'AUTO' ? 'HUG' : 'FIXED'; bump(); } });
  const lsz = (i) => ({
    get() { return n._sz[i]; },
    set(v) {
      if (!['FIXED', 'HUG', 'FILL'].includes(v)) throw new Error('bad layoutSizing ' + v);
      if (!n.parent && v !== 'FIXED') throw new Error('layoutSizing: node must be an auto-layout frame or a child of an auto-layout frame');
      if (v === 'FILL') {
        if (!parentAuto()) throw new Error('FILL can only be set on children of auto-layout frames');
        if (n._lp === 'ABSOLUTE') throw new Error('FILL cannot be set on absolute positioned auto-layout children');
        if (n.type === 'TEXT' && n.textAutoResize === 'WIDTH_AND_HEIGHT') violate('text: FILL set while textAutoResize is WIDTH_AND_HEIGHT (Figma ignores it)');
      }
      if (v === 'HUG' && !(n.type === 'TEXT' || (n.type === 'FRAME' && isAutoNode()))) throw new Error('HUG can only be set on auto-layout frames or text children of auto-layout frames');
      n._sz[i] = v; bump();
    },
  });
  Object.defineProperty(n, 'layoutSizingHorizontal', lsz(0));
  Object.defineProperty(n, 'layoutSizingVertical', lsz(1));
  Object.defineProperty(n, 'layoutPositioning', { get() { return n._lp || 'AUTO'; }, set(v) { if (v === 'ABSOLUTE' && !parentAuto()) throw new Error('layoutPositioning ABSOLUTE needs an auto-layout parent'); n._lp = v; bump(); } });
  for (const p of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) Object.defineProperty(n, p, { get() { return n['_' + p] ?? null; }, set(v) { if (!(isAutoNode() || parentAuto())) throw new Error(p + ' only on auto-layout frames and their children'); n['_' + p] = v; bump(); } });
  Object.defineProperty(n, 'layoutWrap', { get() { return n._lw || 'NO_WRAP'; }, set(v) { if (v === 'WRAP' && n._layoutMode !== 'HORIZONTAL') throw new Error('WRAP only on HORIZONTAL'); n._lw = v; bump(); } });
  Object.defineProperty(n, 'counterAxisAlignContent', { get() { return n._cac || 'AUTO'; }, set(v) { if (n.layoutWrap !== 'WRAP') throw new Error('counterAxisAlignContent needs WRAP'); n._cac = v; bump(); } });
  Object.defineProperty(n, 'counterAxisSpacing', { get() { return n._cas || 0; }, set(v) { if (n.layoutWrap !== 'WRAP') throw new Error('counterAxisSpacing needs WRAP'); n._cas = v; bump(); } });
  for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'strokesIncludedInLayout']) {
    let val = p === 'strokesIncludedInLayout' ? false : 0;
    Object.defineProperty(n, p, { get() { return val; }, set(v) { if (!isAutoNode()) throw new Error(p + ' needs an auto-layout frame'); val = v; bump(); } });
  }
  for (const p of ['primaryAxisAlignItems', 'counterAxisAlignItems']) {
    let val = 'MIN';
    Object.defineProperty(n, p, { get() { return val; }, set(v) { if (!isAutoNode()) throw new Error(p + ' needs an auto-layout frame'); if (['SPACE_BETWEEN', 'SPACE_AROUND', 'SPACE_EVENLY'].includes(v) && p !== 'primaryAxisAlignItems') throw new Error('bad ' + p); val = v; bump(); } });
  }
  for (const p of ['gridColumnGap', 'gridRowGap', 'gridAutoTracks', 'gridItemsPositioning']) {
    let val = p === 'gridItemsPositioning' ? 'MANUAL' : p === 'gridAutoTracks' ? 'NONE' : 0;
    Object.defineProperty(n, p, { get() { return val; }, set(v) { if (n._layoutMode !== 'GRID') throw new Error(p + ' needs a GRID frame'); val = v; bump(); } });
  }
  Object.defineProperty(n, 'gridColumnCount', { get() { return n._grid.cols.length; }, set(v) { if (n._layoutMode !== 'GRID') throw new Error('gridColumnCount needs GRID'); while (n._grid.cols.length < v) n._grid.cols.push({ type: 'FLEX', value: 1 }); n._grid.cols.length = v; bump(); } });
  Object.defineProperty(n, 'gridRowCount', { get() { return n._grid.rows.length; }, set(v) { if (n._layoutMode !== 'GRID') throw new Error('gridRowCount needs GRID'); while (n._grid.rows.length < v) n._grid.rows.push({ type: 'FLEX', value: 1 }); n._grid.rows.length = v; bump(); } });
  Object.defineProperty(n, 'gridColumnSizes', { get() { return n._grid.cols; } });
  Object.defineProperty(n, 'gridRowSizes', { get() { return n._grid.rows; } });
  n._cell = null;
  Object.defineProperty(n, 'gridRowAnchorIndex', { get() { return n._cell ? n._cell[0] : 0; } });
  Object.defineProperty(n, 'gridColumnAnchorIndex', { get() { return n._cell ? n._cell[1] : 0; } });
  for (const [p, d] of [['gridRowSpan', 1], ['gridColumnSpan', 1], ['gridChildHorizontalAlign', 'AUTO'], ['gridChildVerticalAlign', 'AUTO']]) {
    let val = d;
    Object.defineProperty(n, p, { get() { return val; }, set(v) { if (!(n.parent && n.parent._layoutMode === 'GRID')) throw new Error(p + ' needs a GRID parent'); val = v; bump(); } });
  }
  n.setGridChildPosition = (r, c) => {
    const g = n.parent;
    if (!g || g._layoutMode !== 'GRID') throw new Error('setGridChildPosition needs a GRID parent');
    if (g.gridItemsPositioning !== 'MANUAL') throw new Error('setGridChildPosition in ROW_AUTO_FLOW');
    if (r >= g.gridRowCount || c >= g.gridColumnCount) throw new Error('grid position out of bounds');
    if (g.children.some((k) => k !== n && k._cell && k._cell[0] === r && k._cell[1] === c)) throw new Error('grid cell occupied');
    n._cell = [r, c]; bump();
  };
  n.appendChild = (c) => {
    if (c.parent) c.parent.children = c.parent.children.filter((k) => k !== c);
    c.parent = n; n.children.push(c);
    if (n.type === 'FRAME' && n._layoutMode === 'GRID') {
      for (let r = 0; r < n.gridRowCount && !c._cell; r++) for (let q = 0; q < n.gridColumnCount; q++) if (!n.children.some((k) => k !== c && k._cell && k._cell[0] === r && k._cell[1] === q)) { c._cell = [r, q]; break; }
    }
    bump();
  };
  n.appendChildAt = (c, r, q) => { n.appendChild(c); c._cell = null; c.setGridChildPosition(r, q); };
  n.remove = () => { if (n.parent) { n.parent.children = n.parent.children.filter((k) => k !== n); n.parent = null; bump(); } };
  n.setRangeFontName = n.setRangeFontSize = n.setRangeFills = n.setRangeTextDecoration = () => {};
  n.setPluginData = () => {};
  if (type === 'TEXT') {
    n._sz = ['HUG', 'HUG'];
    let tar = 'WIDTH_AND_HEIGHT';
    Object.defineProperty(n, 'textAutoResize', {
      get() { return tar; },
      set(v) {
        if (!['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE'].includes(v)) throw new Error('bad textAutoResize ' + v);
        tar = v;
        if (v === 'WIDTH_AND_HEIGHT') n._sz = ['HUG', 'HUG'];
        else if (v === 'HEIGHT') { if (n._sz[0] === 'HUG') n._sz[0] = 'FIXED'; n._sz[1] = 'HUG'; }
        else { if (n._sz[0] === 'HUG') n._sz[0] = 'FIXED'; if (n._sz[1] === 'HUG') n._sz[1] = 'FIXED'; }
        bump();
      },
    });
    n.textTruncation = 'DISABLED'; n.maxLines = null;
  }
  return n;
}

// ---- layout: rebuild boxes for the top-most frame and run the engine
function topOf(n) { let t = n; while (t.parent && t.parent.type === 'FRAME') t = t.parent; return t; }
function textBox(n, sz) {
  const m = n._metric || { w: n._w, h: n._h, l: 1 };
  const nw = m.w * TEXT_SCALE, nh = m.h;
  const b = { w: n._w, h: n._h, leaf: true, text: true, nw, nh };
  b.thFn = (w) => (m.l > 1 || w < nw - 0.5 ? (m.h / m.l) * Math.max(1, Math.ceil((m.w * m.l * TEXT_SCALE) / Math.max(w, 1) - 0.02)) : nh);
  if (n.textTruncation === 'ENDING' && n.maxLines) { const lh1 = m.h / m.l; b.thFn = () => lh1 * Math.min(n.maxLines, m.l); }
  if (n.textAutoResize === 'NONE') { b.sw = 'F'; b.sh = 'F'; b.nw = n._w; b.nh = n._h; b.thFn = null; }
  else if (n.textAutoResize === 'WIDTH_AND_HEIGHT') { b.sw = 'H'; b.sh = 'H'; }
  else { b.sw = sz[0] === 'FILL' ? 'L' : 'F'; b.sh = 'H'; }
  return b;
}
// padding as the engine sees it: with strokesIncludedInLayout the stroke widths are added (assumption V1, see docs/VERIFY-IN-FIGMA.md)
function padOf(n) {
  const w = (side) => (n.strokesIncludedInLayout && n.strokes && n.strokes.length ? (n['stroke' + side + 'Weight'] ?? n.strokeWeight ?? 0) : 0);
  return [n.paddingTop + w('Top'), n.paddingRight + w('Right'), n.paddingBottom + w('Bottom'), n.paddingLeft + w('Left')];
}
function toBox(n) {
  const sz = n._sz.slice();
  let b;
  if (n.type === 'TEXT') b = textBox(n, sz);
  else if (n.type === 'FRAME' && AUTO.includes(n._layoutMode)) {
    b = { w: n._w, h: n._h, lm: n._layoutMode === 'VERTICAL' ? 'V' : n._layoutMode === 'GRID' ? 'G' : 'H', wrap: n.layoutWrap === 'WRAP', gap: n.itemSpacing, gap2: n.counterAxisSpacing, pad: padOf(n), pa: n.primaryAxisAlignItems, ca: n.counterAxisAlignItems, ac: n.counterAxisAlignContent };
    if (b.lm === 'G') { b.cols = n._grid.cols.map((c) => ({ t: c.type, v: c.value })); b.rows = n._grid.rows.map((c) => ({ t: c.type, v: c.value })); b.cg = n.gridColumnGap; b.rg = n.gridRowGap; }
    b.kids = n.children.map(toBox);
    if (b.lm === 'G') b.kids.forEach((kb, i) => { const c = n.children[i]; kb.gp = c._cell ? [c._cell[0], c._cell[1], c.gridRowSpan, c.gridColumnSpan] : [0, 0, 1, 1]; kb.ga = [c.gridChildHorizontalAlign === 'AUTO' ? 'MIN' : c.gridChildHorizontalAlign, c.gridChildVerticalAlign === 'AUTO' ? 'MIN' : c.gridChildVerticalAlign]; });
  } else if (n.type === 'FRAME' && n.children.length) b = { w: n._w, h: n._h, lm: 'N', kids: n.children.map(toBox) };
  else b = { w: n._w, h: n._h, leaf: true };
  b.x = n._x; b.y = n._y; b.node = n;
  const par = n.parent;
  const inAuto = par && par.type === 'FRAME' && AUTO.includes(par._layoutMode);
  const M = { FIXED: 'F', HUG: 'H', FILL: 'L' };
  if (n.type !== 'TEXT') { b.sw = inAuto ? M[sz[0]] : 'F'; b.sh = inAuto ? M[sz[1]] : 'F'; }
  else if (!inAuto && b.sw === 'L') b.sw = 'F';
  if (inAuto && n._lp === 'ABSOLUTE') b.abs = true;
  if (n._minWidth != null || n._minHeight != null) b.mn = [n._minWidth ?? null, n._minHeight ?? null];
  if (n._maxWidth != null || n._maxHeight != null) b.mx = [n._maxWidth ?? null, n._maxHeight ?? null];
  return b;
}
function relayout(n) {
  const top = topOf(n);
  const box = toBox(top);
  const sz = top._sz;
  layoutBox(box, sz[0] === 'HUG' ? null : top._w, sz[1] === 'HUG' ? null : top._h);
  (function assign(b, isTop) {
    const nd = b.node; nd._v = version;
    nd._lay = { rw: b.rw, rh: b.rh, rx: isTop ? nd._x : (b.rx != null ? b.rx : nd._x), ry: isTop ? nd._y : (b.ry != null ? b.ry : nd._y) };
    for (const k of b.kids || []) assign(k, false);
  })(box, true);
}

const page = mkNode('PAGE'); page.children = [];
let imgCount = 0;
const reg = (nd) => { created.push(nd); return nd; };
const figma = {
  showUI() {}, ui: { postMessage: (m) => { if (m.log) logs.push(m.log); } }, currentPage: page, viewport: { scrollAndZoomIntoView() {} },
  createFrame: () => reg(mkNode('FRAME')), createText: () => { const t = reg(mkNode('TEXT')); t._h = 16; t._metric = textList[textSeq++]; return t; }, createRectangle: () => reg(mkNode('RECTANGLE')),
  createSection: () => { const s = mkNode('SECTION'); page.children.push(s); return s; },
  createNodeFromSvg: (s) => { if (/\bBAD\b/.test(s)) throw new Error('bad svg'); return reg(mkNode('FRAME')); },
  createImage: (b) => { if (!b || !b.length) throw new Error('empty'); return { hash: 'h' + (++imgCount) }; },
  base64Decode: (s) => Buffer.from(s, 'base64'),
  loadFontAsync: async () => {}, listAvailableFontsAsync: async () => [{ fontName: { family: 'Vazirmatn', style: 'Regular' } }, { fontName: { family: 'Vazirmatn', style: 'Bold' } }, { fontName: { family: 'Inter', style: 'Regular' } }],
  variables: {
    getLocalVariablesAsync: async () => [{ id: 'v1', variableCollectionId: 'c1', valuesByMode: { m: { r: 0.0392, g: 0.0431, b: 0.051, a: 1 } } }, { id: 'v2', variableCollectionId: 'c2', valuesByMode: { m: { type: 'VARIABLE_ALIAS', id: 'v1' } } }],
    getLocalVariableCollectionsAsync: async () => [{ id: 'c1', name: 'Primitives', defaultModeId: 'm' }, { id: 'c2', name: 'Color', defaultModeId: 'm' }],
    getVariableByIdAsync: async () => null,
    setBoundVariableForPaint: (p, f, v) => ({ ...p, boundVariables: { color: { id: v.id } } }),
  },
};
const ctx = { figma, __html__: '', setTimeout, console, Object, Math, JSON, Array, Map, Set, String, Number, Promise, Date, Error };
vm.createContext(ctx);
const here = new URL('.', import.meta.url);
vm.runInContext(fs.readFileSync(new URL('plugin/code.js', here), 'utf8'), ctx);
await figma.ui.onmessage({ type: 'build', data, opts: { bindVars: bind, sectionName: null, autoLayout: !NO_LAYOUT } });
if (!QUIET) console.log(logs.join('\n'));
const sec = page.children.find((c) => c.type === 'SECTION');
console.log('section', sec.name, Math.round(sec.width) + 'x' + Math.round(sec.height), 'frames', sec.children.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`).join(' | '));

// ---- invariants over the finished tree
(function check(n) {
  const par = n.parent;
  for (const c of n.children) check(c);
  if (n.type === 'SECTION' || n.type === 'PAGE') return;
  const pa = par && par.type === 'FRAME' && AUTO.includes(par._layoutMode);
  if (!pa && n._sz.includes('FILL')) violate('FILL under a non auto-layout parent (final state)');
  if (n.type === 'TEXT') {
    if (n._sz[0] === 'FILL' && n.textAutoResize === 'WIDTH_AND_HEIGHT') violate('text FILL with WIDTH_AND_HEIGHT (final state)');
    if (n.width < 2 && n.characters.length > 1) violate('text collapsed to a thread (width < 2)');
  }
  if (n.type !== 'TEXT' && n.type !== 'FRAME' && n._sz.includes('HUG')) violate('HUG on a non-frame, non-text node');
  if (n.type === 'FRAME' && !AUTO.includes(n._layoutMode) && n._sz.includes('HUG')) violate('HUG on a frame without auto-layout (final state)');
})(sec);

// ---- fidelity: compare the mock's resulting rectangles with the JSON (creation order == JSON pre-order)
const treeNodes = [];
for (const fr of data.frames) (function walk(n, ox, oy, isRoot) {
  const ax = isRoot ? 0 : ox + n.x, ay = isRoot ? 0 : oy + n.y;
  treeNodes.push({ n, ax, ay });
  for (const c of n.children || []) walk(c, ax, ay, false);
})(fr, 0, 0, true);
const absOf = (nd) => { let x = 0, y = 0; for (let p = nd; p && p.parent && p.parent.type !== 'SECTION' && p.parent.type !== 'PAGE'; p = p.parent) { x += p.x; y += p.y; } return { x, y }; };
if (created.length === treeNodes.length) {
  const deltas = [];
  created.forEach((nd, i) => {
    const t = treeNodes[i], n = t.n;
    if ((n.t === 'text') !== (nd.type === 'TEXT')) return;
    const a = absOf(nd);
    const padX = nd.type === 'TEXT' && !n.ls && !n.fixed ? 1 : 0;
    deltas.push({ name: n.name || n.text, t: n.t, dx: a.x - t.ax + padX, dy: a.y - t.ay, dw: nd.width - n.w, dh: nd.height - n.h });
  });
  const within = (tol) => deltas.filter((d) => Math.abs(d.dx) <= tol && Math.abs(d.dy) <= tol).length;
  const pct = (v) => (100 * v / (deltas.length || 1)).toFixed(1) + '%';
  console.log(`position fidelity vs JSON (mock layout engine): within 2px ${pct(within(2))}, 4px ${pct(within(4))}, 8px ${pct(within(8))} of ${deltas.length} nodes (text scale ${TEXT_SCALE})`);
  const worst = deltas.slice().sort((p, q) => Math.max(Math.abs(q.dx), Math.abs(q.dy)) - Math.max(Math.abs(p.dx), Math.abs(p.dy))).slice(0, 4);
  if (worst.length && !QUIET) console.log('worst:', worst.map((d) => `${d.t} ${String(d.name).slice(0, 18)} dx${d.dx.toFixed(1)} dy${d.dy.toFixed(1)}`).join(' | '));
} else console.log(`fidelity skipped: created ${created.length} nodes vs ${treeNodes.length} in JSON`);
if (violations.size) { console.log('MOCK VIOLATIONS:'); for (const [k, v] of violations) console.log('  ' + v + 'x ' + k); } else console.log('mock violations: none');
