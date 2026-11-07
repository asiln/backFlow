// Per-core analysis (correspondence, slots, values, overrides) and `_library.json` assembly (spec 2.5, 7.1, 7.2).
//
// inferVariants(core) is the T9 hook. Contract for the real implementation (tools/ds/components/variants.mjs):
//   input  core = { id, name, leader(view), members:[{ v(view), dev, corr[], values(Map) }], slots[], paletteGroups }
//   output null (no variants) or { props: Record<string,string[]>, members:[{ v: Record<string,string>, root?: Node, n: number }],
//            memberV: Map<rawNode, Record<string,string>> }  -> memberV entries become cmp.v on the member nodes.
import { slotsClose } from '../common/hash.mjs';
import { canonicalJson } from '../common/hash.mjs';
import { preorder } from './view.mjs';
import { correspond, alignedDist, paintDesc, paintDiffFields } from './cluster.mjs';

export function inferVariants(/* core */) { return null; }

const round2 = (x) => Math.round(x * 100) / 100;
const iconOf = (v) => (v.t === 'svg' && v.n.cmp && v.n.cmp.kind === 'icon' ? v.n.cmp : null);

// ------------------------------------------------------------------ values
function valueOf(kind, v) {
  switch (kind) {
    case 'text': return { t: v.n.text || '', r: v.n.runs && v.n.runs.length ? v.n.runs : null };
    case 'swap': { const c = iconOf(v); return { ic: c ? c.id : null, c: (v.tok && v.tok.ic) || null }; }
    case 'img': return { id: v.n.asset || v.n.data || '', fit: v.n.fit || null, asset: v.n.asset || null, data: v.n.asset ? null : v.n.data || null };
    case 'fill': return { d: paintDesc(v), tok: v.tok || {} };
    default: return {};
  }
}
function same(kind, a, b, tol) {
  switch (kind) {
    case 'text': return a.t === b.t && canonicalJson(a.r) === canonicalJson(b.r);
    case 'swap': return a.ic === b.ic && (a.c || null) === (b.c || null);
    case 'img': return a.id === b.id;
    case 'fill': return paintDiffFields(a.d, b.d, tol).length === 0;
    case 'bool': return a === b;
    default: return true;
  }
}
const rgba = (p) => (p ? { r: p.c.r, g: p.c.g, b: p.c.b, a: p.c.a == null ? 1 : p.c.a } : { r: 0, g: 0, b: 0, a: 0 });
function overrideOf(key, kind, val, def, tol) {
  switch (kind) {
    case 'text': { const o = { s: key, t: val.t }; if (val.r) o.r = val.r; return o; }
    case 'bool': return { s: key, b: val };
    case 'swap': { const o = { s: key, ic: val.ic }; if (val.c) o.c = val.c; return o; }
    case 'img': { const im = {}; if (val.asset) im.asset = val.asset; else if (val.data) im.data = val.data; if (val.fit) im.fit = val.fit; return { s: key, img: im }; }
    case 'fill': {
      const fields = paintDiffFields(val.d, def.d, tol);
      const o = { s: key };
      const fp = val.d.f || val.d.tx, dfp = def.d.f || def.d.tx;
      if (fields.includes('f') || fields.includes('tx')) { o.fill = rgba(fp); const k = val.tok.f || val.tok.tx; if (k && fp) o.fillTok = k; }
      if (fields.includes('s')) { o.stroke = rgba(val.d.s); if (val.tok.s && val.d.s) o.strokeTok = val.tok.s; }
      if (fields.includes('op')) o.op = Math.max(0, Math.min(1, val.d.op));
      void dfp;
      return Object.keys(o).length > 1 ? o : null;
    }
    default: return null;
  }
}
const keyCmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; }
  return 0;
};

/**
 * Analyse one clustered core. Returns { ok, rejected[], members[], slots[], defaults, devMean, devMax, ... }.
 * `assigns` maps raw node -> { values: Map<key,{kind,val}> } of already accepted (inner) components.
 */
export function analyseCore(core, P, assigns) {
  const tol = { deltaE: P.colorDeltaE, alphaTol: P.alphaTol };
  const master = core.leader;
  const pm = preorder(master);
  const idx = new Map(pm.map((v, i) => [v, i]));
  const rejected = [];
  const mem = [];
  for (const m of core.members) {
    const corr = m.v === master ? pm : correspond(master, m.v, P.maxOptional);
    if (!corr) { rejected.push({ v: m.v, reason: 'align' }); continue; }
    const { dev, ok } = alignedDist(pm, corr);
    if (!ok) { rejected.push({ v: m.v, reason: 'tolerance' }); continue; }
    mem.push({ v: m.v, corr, dev: round2(dev) });
  }
  if (!mem.some((m) => m.v === master)) return { ok: false, rejected, members: mem };
  const N = pm.length;
  const parentIdx = pm.map((v, i) => (i === 0 ? -1 : idx.get(v.parent) ?? -1));

  // ---- slot detection
  const specs = []; // {i, kind}
  let varying = 0;
  for (let i = 0; i < N; i++) {
    const node = pm[i];
    let absent = 0, present = 0;
    for (const m of mem) {
      if (i === 0) { present++; continue; }
      if (m.corr[parentIdx[i]]) { if (m.corr[i]) present++; else absent++; }
    }
    const optional = absent > 0 && present > 0;
    if (optional) specs.push({ i, kind: 'bool', present, absent });
    let nodeVaries = optional;
    const mv = (k) => valueOf(k, node);
    if (node.inst) { specs.push({ i, kind: 'inst' }); nodeVaries = true; } else if (node.t === 'text') {
      const base = mv('text');
      if (mem.some((m) => m.corr[i] && !same('text', valueOf('text', m.corr[i]), base))) { specs.push({ i, kind: 'text' }); nodeVaries = true; }
    } else if (node.t === 'svg') {
      const base = mv('swap');
      if (base.ic && (optional || mem.some((m) => m.corr[i] && !same('swap', valueOf('swap', m.corr[i]), base)))) { specs.push({ i, kind: 'swap' }); nodeVaries = true; }
    } else if (node.t === 'img') {
      const base = mv('img');
      if (mem.some((m) => m.corr[i] && !same('img', valueOf('img', m.corr[i]), base))) { specs.push({ i, kind: 'img' }); nodeVaries = true; }
    }
    if (node.t !== 'svg' && !node.inst) {
      const base = mv('fill');
      if (mem.some((m) => m.corr[i] && m.corr[i].dg.P !== node.dg.P && !same('fill', valueOf('fill', m.corr[i]), base, tol))) { specs.push({ i, kind: 'fill' }); nodeVaries = true; }
    }
    if (nodeVaries) varying++;
  }
  // metric-only variation also counts for the data-shape guard
  let metricVar = 0;
  for (let i = 0; i < N; i++) if (mem.some((m) => m.corr[i] && m.corr[i].dg.M !== pm[i].dg.M && m.corr[i].kids.length === pm[i].kids.length && m.corr[i] !== pm[i])) metricVar++;
  const varFrac = Math.max(varying, Math.min(N, metricVar)) / N;

  // ---- slots (keys are indices)
  const slots = specs.map((sp, j) => ({ ...sp, s: String(j) }));

  // ---- values per member, defaults
  const defaults = new Map();
  const memberVals = [];
  const nestedOf = (node) => (assigns.get(node.n) || null);
  for (const sp of slots) {
    const node = pm[sp.i];
    if (sp.kind === 'bool') defaults.set(sp.s, { kind: 'bool', val: sp.present >= sp.absent });
    else if (sp.kind === 'inst') {
      const a = nestedOf(node);
      if (a) for (const [k, e] of a.values) defaults.set(`${sp.s}.${k}`, e);
    } else defaults.set(sp.s, { kind: sp.kind, val: valueOf(sp.kind, node) });
  }
  for (const m of mem) {
    const vals = new Map();
    for (const sp of slots) {
      const node = m.corr[sp.i];
      if (sp.kind === 'bool') { if (m.corr[parentIdx[sp.i]] || sp.i === 0) vals.set(sp.s, { kind: 'bool', val: !!node }); continue; }
      if (!node) continue;
      if (sp.kind === 'inst') {
        const a = nestedOf(node);
        if (a) for (const [k, e] of a.values) vals.set(`${sp.s}.${k}`, e);
      } else vals.set(sp.s, { kind: sp.kind, val: valueOf(sp.kind, node) });
    }
    m.values = vals;
    memberVals.push(vals);
  }
  for (const m of mem) {
    const ov = [];
    for (const [key, e] of m.values) {
      const d = defaults.get(key);
      if (!d) continue;
      if (same(e.kind, e.val, d.val, tol)) continue;
      const o = overrideOf(key, e.kind, e.val, d.val, tol);
      if (o) ov.push(o);
    }
    ov.sort((a, b) => keyCmp(a.s, b.s));
    m.ov = ov;
  }

  // ---- stats
  const devs = mem.map((m) => m.dev);
  const devMean = devs.length ? round2(devs.reduce((a, b) => a + b, 0) / devs.length) : 0;
  const devMax = devs.length ? Math.max(...devs) : 0;
  let hasAbsKids = false;
  for (let i = 1; i < N; i++) if (pm[i].abs) hasAbsKids = true;
  let textOverflowRisk = false;
  for (const sp of slots) {
    if (sp.kind !== 'text') continue;
    const node = pm[sp.i];
    if (node.s[0] !== 'F') continue;
    const lens = mem.filter((m) => m.corr[sp.i]).map((m) => (m.corr[sp.i].n.text || '').length);
    const lo = Math.max(1, Math.min(...lens)), hi = Math.max(...lens);
    if (hi >= 12 && hi / lo >= 3) textOverflowRisk = true;
  }
  const dataShaped = N > P.dataShapedNodes && varFrac > P.dataShapedFrac;
  const occ = mem.length;
  const sc = new Set(), fi = new Set();
  for (const m of mem) { sc.add(m.v.scr); fi.add(m.v.scr.fi); }
  return {
    ok: true, rejected, members: mem, slots, defaults, pm, N, devMean, devMax, hasAbsKids, textOverflowRisk, dataShaped, varFrac: round2(varFrac),
    occ, screens: sc.size, files: fi.size, nodes: master.dg.nodes, styled: master.styled,
  };
}

// ------------------------------------------------------------------ slot names / paths
const dedupe = (names) => {
  const seen = new Map();
  return names.map((n) => { const k = seen.get(n) || 0; seen.set(n, k + 1); return k ? `${n} ${k + 1}` : n; });
};

export function slotNames(core, an, compNameOf) {
  const { slots, pm } = an;
  const texts = slots.filter((s) => s.kind === 'text').map((s) => ({ s, size: (pm[s.i].n.font || {}).size || 0 }));
  const rank = new Map();
  [...texts].sort((a, b) => b.size - a.size || a.s.i - b.s.i).forEach((t, r) => rank.set(t.s, r));
  const instCount = new Map();
  const names = slots.map((s) => {
    const node = pm[s.i];
    switch (s.kind) {
      case 'text': return texts.length === 1 ? 'Label' : rank.get(s) === 0 ? 'Title' : rank.get(s) === 1 ? 'Body' : `Text ${rank.get(s) + 1}`;
      case 'bool': return 'Show ' + (node.t === 'svg' ? 'icon' : node.t === 'text' ? 'text' : node.t === 'img' ? 'image' : node.inst ? (compNameOf(node.inst.id) || 'part').toLowerCase() : (node.role || 'part'));
      case 'swap': return 'Icon';
      case 'img': return 'Image';
      case 'fill': return node.t === 'text' ? 'Text colour' : 'Fill';
      case 'inst': { const nm = compNameOf(node.inst.id) || 'Component'; const k = (instCount.get(nm) || 0) + 1; instCount.set(nm, k); return `${nm} ${k}`; }
      default: return 'Slot';
    }
  });
  // single inst of a name: drop the " 1"
  const per = new Map();
  slots.forEach((s, i) => { if (s.kind === 'inst') per.set(names[i].replace(/ \d+$/, ''), (per.get(names[i].replace(/ \d+$/, '')) || 0) + 1); });
  slots.forEach((s, i) => { if (s.kind === 'inst' && per.get(names[i].replace(/ \d+$/, '')) === 1) names[i] = names[i].replace(/ 1$/, ''); });
  return dedupe(names);
}

export function slotPath(an, sp, rootPathLen) {
  return an.pm[sp.i].path.slice(rootPathLen);
}

// ------------------------------------------------------------------ library component
const stripImgData = (n) => {
  if (n.t === 'img') delete n.data;
  if (n.children) n.children.forEach(stripImgData);
};

export function exemplarRoot(raw) {
  const root = JSON.parse(JSON.stringify(raw));
  delete root.cmp;
  root.x = 0; root.y = 0;
  stripImgData(root);
  return root;
}

export function libComponent(core, an, meta) {
  const names = slotNames(core, an, meta.compNameOf);
  const rootLen = core.leader.path.length;
  const slots = an.slots.map((sp, j) => {
    const d = an.defaults.get(sp.s);
    const o = { s: sp.s, kind: sp.kind, path: slotPath(an, sp, rootLen), name: names[j] };
    if (sp.kind === 'text') o.default = d.val.t;
    else if (sp.kind === 'bool') o.default = d.val;
    else if (sp.kind === 'swap') o.default = d.val.ic;
    return o;
  });
  const lc = {
    id: meta.id, name: meta.name, group: meta.group, conf: meta.conf, band: meta.band, nameSource: meta.nameSource, sig: meta.sig,
    root: exemplarRoot(core.leader.n), slots,
    stats: { occ: an.occ, screens: an.screens, files: an.files, devMean: an.devMean, devMax: an.devMax },
  };
  if (meta.notes && meta.notes.length) lc.notes = meta.notes;
  return lc;
}

export { slotsClose };
