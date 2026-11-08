// Variant inference (spec 2.6, T9 hook of library.mjs). A component whose members differ in PAINT (fill, stroke, text colour, opacity) is turned
// into a variant set instead of colour overrides on every instance:
//   - one tuple per member = the paint of every `fill` slot (a node whose paint varies across the members);
//   - tuples used by at least `minUses` members become variants (at most `maxVariants`), the rest keep their overrides;
//   - one property when a single slot varies or the tuples are not a full matrix, one property per slot when they are (no holes, E5).
// Text, icon and visibility differences stay slots (component properties); they are not variant axes.
//
// inferVariants(core) -> null | { props, members:[{v, root, n}], memberV: Map<rawNode, v>, dropSlots: Set<slotId>, prune: Set<rawNode> }
//   dropSlots: fill slots that are now variant-driven (kept in the library slots: outer components may reference them as nested overrides)
//   prune:     member nodes whose fill overrides on those slots are redundant (they sit on a variant of their own)
import { preorder } from './view.mjs';
import { exemplarRoot } from './library.mjs';

const DEFAULTS = { minUses: 2, maxVariants: 24, maxProps: 3 };
const q2 = (x) => Math.round((x == null ? 1 : x) * 100) / 100;
const part = (d) => (d ? [d.f && d.f.key, d.s && d.s.key, d.tx && d.tx.key, d.ic && d.ic.key, q2(d.op)].map((x) => x ?? '').join('|') : '-');
const hexOf = (key) => { const m = /^c:([0-9a-f]{6})@(\d+)$/i.exec(key || ''); return m ? '#' + m[1].toUpperCase() + (m[2] === '100' ? '' : ' ' + m[2] + '%') : null; };
function labelOf(d) {
  if (!d) return 'None';
  const k = (d.f && d.f.key) || (d.tx && d.tx.key) || (d.ic && d.ic.key) || (d.s && d.s.key);
  const base = hexOf(k) || (k ? String(k) : 'No paint');
  return q2(d.op) < 0.98 ? `${base} (${Math.round(q2(d.op) * 100)}%)` : base;
}
// variant property names must not contain , = or #
const clean = (s) => String(s).replace(/[,=]/g, ' ').trim();
const OWN = ['fill', 'layers', 'grads', 'stroke'];

function copyPaint(dst, src) {
  if (dst.t === 'text') {
    if (src.font && dst.font) dst.font = { ...dst.font, color: src.font.color };
    if (src.tok || dst.tok) { dst.tok = { ...(dst.tok || {}) }; if (src.tok && src.tok.tx) dst.tok.tx = src.tok.tx; else delete dst.tok.tx; }
  } else {
    for (const k of OWN) { if (src[k] !== undefined) dst[k] = JSON.parse(JSON.stringify(src[k])); else delete dst[k]; }
    if (src.tok || dst.tok) { dst.tok = { ...(dst.tok || {}) }; for (const k of ['f', 's', 'gr']) { if (src.tok && src.tok[k] !== undefined) dst.tok[k] = src.tok[k]; else delete dst.tok[k]; } }
  }
  if (src.opacity !== undefined) dst.opacity = src.opacity; else delete dst.opacity;
  if (dst.tok && !Object.keys(dst.tok).length) delete dst.tok;
}
const nodeAt = (root, p) => { let n = root; for (const i of p) { n = n && n.children && n.children[i]; if (!n) return null; } return n; };

export function inferVariants(core, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  const slots = (core.slots || []).filter((s) => s.kind === 'fill');
  if (!slots.length || !core.members || core.members.length < 2 * P.minUses) return null;
  const pm = core.pm || preorder(core.leader), rootLen = core.leader.path.length;

  // ---- tuples
  const byTuple = new Map();
  for (const m of core.members) {
    if (!m.values) continue;
    const parts = slots.map((sp) => { const e = m.values.get(sp.s); return e && e.kind === 'fill' ? part(e.val.d) : part(null); });
    const k = parts.join('\u0001');
    if (!byTuple.has(k)) byTuple.set(k, { k, parts, members: [], descs: slots.map((sp) => { const e = m.values.get(sp.s); return e && e.kind === 'fill' ? e.val.d : null; }) });
    byTuple.get(k).members.push(m);
  }
  const all = [...byTuple.values()].sort((a, b) => b.members.length - a.members.length);
  const kept = all.filter((t) => t.members.length >= P.minUses).slice(0, P.maxVariants);
  if (kept.length < 2) return null;

  // ---- which slots really vary among the kept tuples
  const varying = slots.map((sp, j) => ({ sp, j })).filter(({ j }) => new Set(kept.map((t) => t.parts[j])).size > 1);
  if (!varying.length) return null;
  const distinct = varying.map(({ j }) => [...new Set(kept.map((t) => t.parts[j]))]);
  const product = distinct.reduce((a, d) => a * d.length, 1);
  const matrix = varying.length > 1 && varying.length <= P.maxProps && product === kept.length;

  // ---- property names and value labels
  const label = (j, p) => { const t = kept.find((x) => x.parts[j] === p); return clean(labelOf(t.descs[j])); };
  const uniq = (names) => { const seen = new Map(); return names.map((n) => { const c = seen.get(n) || 0; seen.set(n, c + 1); return c ? `${n} ${c + 1}` : n; }); };
  const props = {};
  const axes = []; // { name, j[], valueOf(tuple) }
  const slotLabel = (sp) => (sp.i === 0 ? 'Style' : pm[sp.i].t === 'text' ? 'Text colour' : 'Fill');
  if (matrix) {
    const names = uniq(varying.map(({ sp }) => slotLabel(sp)));
    varying.forEach(({ j }, a) => {
      const vals = uniq(distinct[a].map((p) => label(j, p)));
      props[names[a]] = vals;
      const map = new Map(distinct[a].map((p, i) => [p, vals[i]]));
      axes.push({ name: names[a], of: (t) => map.get(t.parts[j]) });
    });
  } else {
    const name = varying.length === 1 ? slotLabel(varying[0].sp) : 'Style';
    const vals = varying.length === 1
      ? uniq(kept.map((t) => label(varying[0].j, t.parts[varying[0].j])))
      : uniq(kept.map((t) => clean(varying.map(({ j }) => label(j, t.parts[j])).join(' + '))));
    props[name] = vals;
    const map = new Map(kept.map((t, i) => [t.k, vals[i]]));
    axes.push({ name, of: (t) => map.get(t.k) });
  }
  const vOf = new Map(kept.map((t) => [t, Object.fromEntries(axes.map((a) => [a.name, a.of(t)]))]));

  // ---- variant roots: the leader with the paints of the tuple's first member copied onto the varying slots
  const base = exemplarRoot(core.leader.n);
  const members = kept.map((t) => {
    const root = JSON.parse(JSON.stringify(base));
    const rep = t.members[0];
    for (const { sp } of varying) {
      const src = rep.corr && rep.corr[sp.i];
      const dst = nodeAt(root, pm[sp.i].path.slice(rootLen));
      if (src && src.n && dst) copyPaint(dst, src.n);
    }
    return { v: vOf.get(t), root, n: t.members.length };
  });

  // ---- member assignment: kept tuples exactly, rare tuples go to the most frequent variant and keep their overrides
  const memberV = new Map(), prune = new Set();
  for (const t of all) {
    const keptT = kept.includes(t);
    for (const m of t.members) {
      memberV.set(m.v.n, vOf.get(keptT ? t : kept[0]));
      if (keptT) prune.add(m.v.n);
    }
  }
  return { props, members, memberV, dropSlots: new Set(varying.map(({ sp }) => sp.s)), prune };
}
