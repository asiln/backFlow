// Icon library builder (spec 3, task T5).
//   collectIcons(files, opts) -> { icons: LibIcon[], decorative, stats, meta }
// Finds every `t:'svg'` node, clusters identical geometry (tolerance for sub-pixel rounding), names the clusters, records the
// render sizes and the dominant colour, and annotates each icon node in place with cmp { id, kind:'icon', c?, sz:[w,h] }.
// Big / complex / text-or-gradient-or-filter svgs (illustrations, charts, logos) are NOT icons: they are reported in
// `decorative` and left untouched.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { iconSig, canonicalSvg } from './sig.mjs';
import { clusterSigs, DEFAULT_TOL } from './cluster.mjs';
import { matchDsIcons } from './match.mjs';
import { iconId } from '../common/hash.mjs';

export { iconSig, canonicalSvg, clusterSigs, matchDsIcons };

export const DEFAULTS = {
  tol: DEFAULT_TOL,      // max coordinate deviation (24-unit box) merged into one icon
  maxSize: 64,           // render size (px, longest side) above which an svg is not an icon
  minSize: 4,            // below this it is a dot / bullet
  maxAspect: 4,          // longest / shortest render side
  maxElements: 16,       // drawable elements
  maxSegments: 90,       // path segments over all elements
  minUses: 1,            // clusters used fewer times are reported as decorative ('rare')
  hints: true,           // use aria-label / node name as name hints (3.2)
  hintShare: 0.5,        // share of the cluster that must agree on a hint
  prefix: 'Icon / ',
  annotate: true,
};

const GENERIC = new Set(['svg', 'icon', 'vector', 'image', 'img', 'graphic', 'path', 'group']);

/**
 * Name table hook (3.2): maps geometry `shape` hash -> name. Accepts
 *   Map<shape,name> | { [shape]: name } | { [name]: '<svg ...>' } | [{ name, svg }]
 * so a public lucide-style table (name -> svg) can be loaded from outside the repo; no data is bundled here.
 */
export function buildNameTable(input) {
  const map = new Map();
  if (!input) return map;
  if (input instanceof Map) { for (const [k, v] of input) map.set(k, v); return map; }
  const entries = Array.isArray(input) ? input.map((e) => [e.name, e.svg]) : Object.entries(input);
  for (const [k, v] of entries) {
    if (typeof v !== 'string') continue;
    if (v.trimStart().startsWith('<')) {
      const s = iconSig(v);
      if (!s.info.parseError && !map.has(s.shape)) map.set(s.shape, k);
    } else map.set(k, v);
  }
  return map;
}
/** Reads a JSON name table (`{ "<name>": "<svg>" }` or `{ "<shape>": "<name>" }`) from disk. */
export const loadNameTable = (file) => buildNameTable(JSON.parse(fs.readFileSync(file, 'utf8')));

function* svgNodes(nodes, anc = []) {
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    if (n.t === 'svg' && typeof n.svg === 'string') { yield { node: n, anc }; continue; }
    if (n.children) { anc.push(n); yield* svgNodes(n.children, anc); anc.pop(); }
  }
}
const rootsOf = (f) => {
  const d = f && f.data && !f.frames ? f.data : f;
  return d && (d.frames || d.screens) ? d.frames || d.screens : d && d.t ? [d] : [];
};

/** Why an svg is not an icon, or null. */
export function decorativeReason(sig, node, o) {
  const i = sig.info;
  if (i.parseError) return 'invalid';
  if (i.text) return 'text';
  if (i.image) return 'image';
  if (i.gradient) return 'gradient';
  if (i.filter || i.clip) return 'effects';
  if (i.use) return 'unresolved-use';
  if (!i.elements || !i.subpaths) return 'empty';
  const w = node.w ?? sig.size[0], h = node.h ?? sig.size[1];
  const big = Math.max(w, h), small = Math.min(w, h);
  if (big > o.maxSize) return 'size';
  if (big < o.minSize) return 'tiny';
  if (small > 0 && big / small > o.maxAspect) return 'aspect';
  if (i.elements > o.maxElements || i.segments > o.maxSegments) return 'complex';
  return null;
}

const sizeKey = (n, sig) => {
  const w = n.w ?? sig.size[0], h = n.h ?? sig.size[1];
  return Math.abs(w - h) < 0.5 ? String(w) : `${w}x${h}`;
};

export function collectIcons(files, opts = {}) {
  const t0 = performance.now();
  const o = { ...DEFAULTS, ...opts };
  const names = buildNameTable(o.nameTable);
  const live = new Set(((o.tokens && o.tokens.colors) || []).filter((c) => c.role === 'icon' && ['bound', 'create', 'review'].includes(c.status)).map((c) => c.key));
  const isLive = (k) => live.has(k) || (typeof o.isLiveToken === 'function' && !!o.isLiveToken(k));
  const cache = new Map();
  const stats = { files: 0, frames: 0, svgNodes: 0, iconNodes: 0, decorativeNodes: 0, distinctSvgStrings: 0 };
  const items = [];
  const decor = new Map(); // reason|geom -> record

  for (const f of files) {
    stats.files++;
    for (const root of rootsOf(f)) {
      stats.frames++;
      for (const { node, anc } of svgNodes([root])) {
        stats.svgNodes++;
        let sig = cache.get(node.svg);
        if (!sig) { sig = iconSig(node.svg); cache.set(node.svg, sig); }
        const why = decorativeReason(sig, node, o);
        if (why) {
          stats.decorativeNodes++;
          const key = why + '|' + sig.geom;
          let d = decor.get(key);
          if (!d) decor.set(key, (d = { reason: why, geom: sig.geom, count: 0, size: [node.w ?? sig.size[0], node.h ?? sig.size[1]], elements: sig.info.elements, segments: sig.info.segments }));
          d.count++;
          continue;
        }
        items.push({ sig, node, anc: anc.slice(-3) });
      }
    }
  }
  stats.distinctSvgStrings = cache.size;

  const clusters = clusterSigs(items, { tol: o.tol });
  const icons = [], meta = {}, usedNames = new Set();
  const sizesAll = {};
  const nameStats = { table: 0, hint: 0, hash: 0 };
  const rare = [];

  for (const c of clusters) {
    if (c.count < o.minUses) { rare.push(c); continue; }
    const ls = c.leader.sig;
    // ---- name (3.2)
    let name = null, source = 'hash';
    const shapes = [ls.shape, ...c.items.map((i) => i.sig.shape)];
    for (const s of shapes) if (names.has(s)) { name = names.get(s); source = 'table'; break; }
    if (!name && o.hints) {
      const tally = new Map();
      for (const it of c.items) {
        const h = [it.sig.info.ariaLabel, GENERIC.has(String(it.node.name || '').toLowerCase()) ? null : it.node.name, typeof o.hint === 'function' ? o.hint(it.node, it.anc) : null]
          .map((x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '')).find((x) => x && x.length <= 40);
        if (h) tally.set(h, (tally.get(h) || 0) + 1);
      }
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      if (top && top[1] / c.count >= o.hintShare) { name = o.prefix + top[0]; source = 'hint'; }
    }
    if (!name) name = `${o.prefix}${ls.geom.slice(0, 6)}`;
    let uniq = name;
    if (usedNames.has(uniq) && ls.kind === 'stroke') uniq = `${name} / sw${ls.strokeWidth}`;
    for (let k = 2; usedNames.has(uniq); k++) uniq = `${name} ${k}`;
    usedNames.add(uniq);
    nameStats[source]++;

    // ---- sizes, colours, annotation
    const sizes = {}, colours = new Map();
    for (const it of c.items) {
      const sk = sizeKey(it.node, it.sig);
      sizes[sk] = (sizes[sk] || 0) + 1;
      sizesAll[sk] = (sizesAll[sk] || 0) + 1;
      it.ck = (it.node.tok && it.node.tok.ic) || it.sig.colorKey;
      if (it.ck) colours.set(it.ck, (colours.get(it.ck) || 0) + 1);
    }
    const dom = [...colours.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    const icon = {
      id: iconId(ls.geom), name: uniq, geom: ls.geom, vb: ls.vb, kind: ls.kind,
      ...(ls.kind === 'stroke' && ls.strokeWidth != null ? { strokeWidth: ls.strokeWidth } : {}),
      svg: canonicalSvg(ls),
      sizes: Object.fromEntries(Object.entries(sizes).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))),
      vecPaths: ls.elements.map((_, i) => [i]),
      ...(dom ? { dominantColor: dom[0] } : {}),
    };
    icons.push(icon);
    meta[icon.id] = { shape: ls.shape, nameSource: source, uses: c.count, exactGeoms: c.geoms.size };
    if (o.annotate) {
      for (const it of c.items) {
        const cmp = { id: icon.id, kind: 'icon' };
        if (it.ck && dom && it.ck !== dom[0] && (it.node.tok && it.node.tok.ic ? true : isLive(it.ck))) cmp.c = it.ck;
        cmp.sz = [it.node.w ?? null, it.node.h ?? null];
        it.node.cmp = cmp;
      }
    }
    stats.iconNodes += c.count;
  }
  for (const c of rare) { // below minUses: reported, not annotated
    stats.decorativeNodes += c.count;
    decor.set('rare|' + c.leader.geom, { reason: 'rare', geom: c.leader.geom, count: c.count, size: c.leader.sig.size, elements: c.leader.sig.info.elements, segments: c.leader.sig.info.segments });
  }

  const decorative = [...decor.values()].sort((a, b) => b.count - a.count || (a.geom < b.geom ? -1 : 1));
  const byReason = {};
  for (const d of decorative) {
    const r = (byReason[d.reason] = byReason[d.reason] || { nodes: 0, distinct: 0 });
    r.nodes += d.count;
    r.distinct++;
  }
  const uses = icons.map((i) => meta[i.id].uses).sort((a, b) => b - a);
  Object.assign(stats, {
    icons: icons.length,
    exactGeoms: clusters.reduce((s, c) => s + c.geoms.size, 0),
    mergedByTolerance: clusters.reduce((s, c) => s + c.geoms.size - 1, 0),
    topReuse: uses.slice(0, 10),
    oneOffIcons: uses.filter((u) => u === 1).length,
    decorativeByReason: byReason,
    decorativeDistinct: decorative.length,
    sizes: Object.fromEntries(Object.entries(sizesAll).sort((a, b) => b[1] - a[1])),
    names: nameStats,
    ms: Math.round(performance.now() - t0),
  });
  return { icons, decorative, stats, meta };
}
