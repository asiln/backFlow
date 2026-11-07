// Candidate selection (spec 1.3), tolerance-leader clustering (1.4), optional-part merging (2.4, restricted) and
// thresholds (1.5). Works on views whose digests were filled by digestTree().
import { slotsClose, slotsDistance } from '../common/hash.mjs';
import { coloursClose } from '../common/colour.mjs';
import { INTERACTIVE_ROLES, GENERIC_ROLES, SYNTHETIC_ROLES, preorder, isAncestor, formatPath } from './view.mjs';
import { fullDigest } from './digest.mjs';

export const DEFAULT_PARAMS = {
  occ: 3, occTiny: 4, tinyNodes: 6, screens: 2, minConf: 55, colorDeltaE: 1.5, alphaTol: 0.02,
  minDepth: 1, minNodes: 2, maxNodes: 120, maxAreaFrac: 0.6, overlayFrac: 0.9,
  maxPaintNodes: 4, singleScreenOcc: 6, crossFileOcc: 2, crossFileNodes: 8,
  optMaxNodes: 40, optMaxLeaves: 10, maxOptional: 2, optMaxExtraNodes: 6,
  dataShapedNodes: 40, dataShapedFrac: 0.25, minLeafShare: 0,
  excludeRoles: '^(table|tbody|thead|form|main|section)$',
  exclude: [], maxPasses: 6,
};

export function resolveParams(config = {}) {
  const t = config.thresholds || {};
  const x = config['x-componentize'] || {};
  const p = { ...DEFAULT_PARAMS };
  for (const k of ['occ', 'occTiny', 'tinyNodes', 'screens', 'minConf', 'colorDeltaE', 'alphaTol']) if (t[k] != null) p[k] = t[k];
  Object.assign(p, x);
  p.exclude = [...(config.exclude || []), ...(x.exclude || [])];
  p.excludeRolesRe = new RegExp(p.excludeRoles, 'i');
  p.excludeRes = p.exclude.map(globToRegex);
  return p;
}

export function globToRegex(g) {
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$');
}

export const locatorOf = (v) => `${v.file}/${v.screen}#${v.screenIdx}${v.path.length ? '/' + formatPath(v.path) : ''}`;

/** Reason string when `v` may not be a candidate, else null. */
export function candidateReject(v, P, absorbed) {
  if (v.t !== 'frame' || v.inst) return 'not-frame';
  if (v.depth < P.minDepth) return 'depth';
  if (v.sp || SYNTHETIC_ROLES.has(v.role)) return 'synthetic';
  if (P.excludeRolesRe.test(v.role)) return 'role-excluded';
  const d = v.dg;
  if (d.nodes < P.minNodes || d.nodes > P.maxNodes) return 'size';
  const area = (v.w || 0) * (v.h || 0);
  if (area > P.maxAreaFrac * v.scr.area) return 'area';
  if (v.pos === 'fixed' && area >= P.overlayFrac * v.scr.area) return 'overlay';
  if (!(v.styled || INTERACTIVE_ROLES.has(v.role))) return 'no-interest';
  if (!v.styled && GENERIC_ROLES.has(v.role)) return 'generic';
  if (d.leaves < 1) return 'no-leaf';
  if (absorbed && absorbed.has(v.n)) return 'absorbed';
  // pure container of N equal children (spec 1.3 rule 6)
  if (v.kids.length >= 2 && !v.styled && v.kids.every((k) => k.dg.S === v.kids[0].dg.S)) return 'repeat-container';
  // pass-through wrapper: one child frame of (nearly) the same box and no own paint
  if (v.kids.length === 1 && !v.styled && v.kids[0].t === 'frame') return 'pass-through';
  if (P.excludeRes.length) {
    const loc = locatorOf(v);
    if (P.excludeRes.some((r) => r.test(loc))) return 'excluded';
  }
  return null;
}

// ------------------------------------------------------------------ paints per node (palette groups, fill overrides)
export function paintDesc(v) {
  const o = { f: null, s: null, tx: null, ic: null, op: v.opacity };
  for (const p of v.paints) {
    if (p.role === 'fill' && !o.f) o.f = p;
    else if (p.role === 'stroke' && !o.s) o.s = p;
    else if (p.role === 'text' && !o.tx) o.tx = p;
    else if (p.role === 'icon' && !o.ic) o.ic = p;
  }
  return o;
}
export function paintFieldDiff(a, b, tol) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  if (a.key === b.key) return false;
  return !coloursClose(a.c, b.c, tol);
}
/** names of the paint fields that differ between two node descriptors */
export function paintDiffFields(da, db, tol) {
  const out = [];
  for (const f of ['f', 's', 'tx', 'ic']) if (paintFieldDiff(da[f], db[f], tol)) out.push(f);
  if (Math.abs(da.op - db.op) > 0.02) out.push('op');
  return out;
}
function paintNodeDiffCount(pa, pb, tol) {
  if (pa.length !== pb.length) return Infinity;
  let n = 0;
  for (let i = 0; i < pa.length; i++) if (paintDiffFields(paintDesc(pa[i]), paintDesc(pb[i]), tol).length) n++;
  return n;
}

// ------------------------------------------------------------------ clustering
const byCountDesc = (a, b) => b.members.length - a.members.length || a.order - b.order;

/** Phase A: bucket by Sn, group by M, tolerance leader clustering, palette split. Returns cores. */
export function clusterCandidates(cands, P) {
  const tol = { deltaE: P.colorDeltaE, alphaTol: P.alphaTol };
  const buckets = new Map();
  cands.forEach((v, i) => {
    v.ord = i;
    let b = buckets.get(v.dg.Sn);
    if (!b) buckets.set(v.dg.Sn, (b = []));
    b.push(v);
  });
  const cores = [];
  for (const [Sn, list] of buckets) {
    const mg = new Map();
    for (const v of list) {
      let g = mg.get(v.dg.M);
      if (!g) mg.set(v.dg.M, (g = { M: v.dg.M, members: [], order: v.ord, slots: null }));
      g.members.push(v);
    }
    const groups = [...mg.values()].sort(byCountDesc);
    const local = [];
    for (const g of groups) {
      g.slots = fullDigest(g.members[0]).slots;
      let core = null;
      for (const c of local) if (slotsClose(c.slots, g.slots)) { core = c; break; }
      if (!core) local.push((core = { Sn, slots: g.slots, groups: [], order: g.order }));
      core.groups.push(g);
    }
    for (const c of local) {
      const members = [];
      for (const g of c.groups) {
        const dev = slotsDistance(c.slots, g.slots).dev;
        for (const v of g.members) members.push({ v, dev });
      }
      for (const sc of paletteSplit(members, P, tol)) cores.push({ Sn, slots: c.slots, members: sc, order: sc[0].v.ord });
    }
  }
  cores.sort((a, b) => a.order - b.order);
  cores.forEach((c, i) => { c.id0 = i; finishCore(c); });
  return cores;
}

function paletteSplit(members, P, tol) {
  if (members.length === 1) return [members];
  const pg = new Map();
  for (const m of members) {
    let g = pg.get(m.v.dg.P);
    if (!g) pg.set(m.v.dg.P, (g = { P: m.v.dg.P, members: [], order: m.v.ord, pre: null }));
    g.members.push(m);
  }
  if (pg.size === 1) return [members];
  const groups = [...pg.values()].sort((a, b) => b.members.length - a.members.length || a.order - b.order);
  const subs = [];
  for (const g of groups) {
    g.pre = preorder(g.members[0].v);
    let host = null;
    for (const s of subs) if (paintNodeDiffCount(s.pre, g.pre, tol) <= P.maxPaintNodes) { host = s; break; }
    if (!host) subs.push((host = { pre: g.pre, members: [] }));
    host.members.push(...g.members);
  }
  for (const s of subs) s.members.sort((a, b) => a.v.ord - b.v.ord);
  return subs.map((s) => s.members);
}

/** Pick the leader (first member of the largest palette group) and basic stats. */
export function finishCore(c) {
  const pc = new Map();
  for (const m of c.members) pc.set(m.v.dg.P, (pc.get(m.v.dg.P) || 0) + 1);
  let best = null, bc = -1;
  for (const m of c.members) { const n = pc.get(m.v.dg.P); if (n > bc || (n === bc && m.v.ord < best.v.ord)) { best = m; bc = n; } }
  c.leader = best.v;
  c.paletteGroups = pc.size;
  const sc = new Set(), fi = new Set();
  for (const m of c.members) { sc.add(m.v.scr); fi.add(m.v.scr.fi); }
  c.occ = c.members.length; c.screens = sc.size; c.files = fi.size;
  c.nodes = c.leader.dg.nodes;
  return c;
}

// ------------------------------------------------------------------ optional parts (restricted BOOLEAN merge)
function without(v, target) {
  if (v === target) return null;
  if (!(v.scr === target.scr && v.pre < target.pre && target.pre <= v.end)) return v;
  return { ...v, kids: v.kids.map((k) => without(k, target)).filter(Boolean) };
}
function removableLeaves(v, out = []) {
  for (const k of v.kids) {
    if (k.t !== 'frame' || k.inst) { if (v.kids.length > 1) out.push(k); } else removableLeaves(k, out);
  }
  return out;
}

export function mergeOptional(cores, P) {
  const bySn = new Map();
  for (const c of cores) { let a = bySn.get(c.Sn); if (!a) bySn.set(c.Sn, (a = [])); a.push(c); }
  const parent = cores.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const A of cores) {
    const l = A.leader;
    if (l.dg.nodes > P.optMaxNodes || l.dg.leaves > P.optMaxLeaves || l.dg.leaves < 2) continue;
    for (const leaf of removableLeaves(l)) {
      const pv = without(l, leaf);
      const fd = fullDigest(pv);
      const hit = bySn.get(fd.S);
      if (!hit) continue;
      for (const B of hit) if (B !== A && slotsClose(B.slots, fd.slots)) parent[find(B.id0)] = find(A.id0);
    }
  }
  const comp = new Map();
  for (const c of cores) { const r = find(c.id0); let a = comp.get(r); if (!a) comp.set(r, (a = [])); a.push(c); }
  const out = [];
  for (const list of comp.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    list.sort((a, b) => b.leader.dg.nodes - a.leader.dg.nodes || b.occ - a.occ || a.order - b.order);
    const master = list[0];
    const merged = { Sn: master.Sn, slots: master.slots, members: [], order: Math.min(...list.map((x) => x.order)), id0: master.id0, optional: true, mergedFrom: list.length };
    for (const c of list) merged.members.push(...c.members);
    merged.members.sort((a, b) => a.v.ord - b.v.ord);
    finishCore(merged);
    merged.leader = master.leader;
    merged.nodes = master.leader.dg.nodes;
    out.push(merged);
  }
  return out;
}

// ------------------------------------------------------------------ correspondence master -> member
const sameProps = (x, y, root) => x.t === y.t && x.k === y.k && (root || x.s.join('') === y.s.join('')) && x.abs === y.abs && x.clip === y.clip && x.pos === y.pos && !x.inst && !y.inst && x.t === 'frame';

/** Array aligned with preorder(master): member view or null (optional part absent). Null result: not alignable. */
export function correspond(master, member, maxOptional = 2) {
  const pm = preorder(master);
  if (member.dg.Sn === master.dg.Sn) {
    const pb = preorder(member);
    return pb.length === pm.length ? pb : null;
  }
  const memo = new Map();
  const fit = (a, b, root) => {
    if (a.dg.S === b.dg.S) return 0;
    if (!sameProps(a, b, root)) return Infinity;
    let m = memo.get(a);
    if (!m) memo.set(a, (m = new Map()));
    if (m.has(b)) return m.get(b);
    const ka = a.kids, kb = b.kids;
    const dp = Array.from({ length: ka.length + 1 }, () => new Array(kb.length + 1).fill(Infinity));
    dp[0][0] = 0;
    for (let i = 1; i <= ka.length; i++) {
      const ex = ka[i - 1].dg.nodes <= 6 ? 1 : Infinity;
      for (let j = 0; j <= Math.min(i, kb.length); j++) {
        let best = dp[i - 1][j] + ex;
        if (j > 0) best = Math.min(best, dp[i - 1][j - 1] + fit(ka[i - 1], kb[j - 1], false));
        dp[i][j] = best;
      }
    }
    m.set(b, dp[ka.length][kb.length]);
    return dp[ka.length][kb.length];
  };
  if (fit(master, member, true) > maxOptional) return null;
  const map = new Map();
  const fill = (a, b, root) => {
    map.set(a, b);
    if (a.dg.S === b.dg.S) { const pa = preorder(a), pb = preorder(b); pa.forEach((x, i) => map.set(x, pb[i])); return; }
    const ka = a.kids, kb = b.kids;
    let i = ka.length, j = kb.length;
    const dp = Array.from({ length: ka.length + 1 }, () => new Array(kb.length + 1).fill(Infinity));
    dp[0][0] = 0;
    for (let x = 1; x <= ka.length; x++) {
      const ex = ka[x - 1].dg.nodes <= 6 ? 1 : Infinity;
      for (let y = 0; y <= Math.min(x, kb.length); y++) {
        let best = dp[x - 1][y] + ex;
        if (y > 0) best = Math.min(best, dp[x - 1][y - 1] + fit(ka[x - 1], kb[y - 1], false));
        dp[x][y] = best;
      }
    }
    while (i > 0) {
      const ex = ka[i - 1].dg.nodes <= 6 ? 1 : Infinity;
      if (j > 0 && dp[i][j] === dp[i - 1][j - 1] + fit(ka[i - 1], kb[j - 1], false)) { fill(ka[i - 1], kb[j - 1], false); i--; j--; } else if (dp[i][j] === dp[i - 1][j] + ex) i--;
      else return;
    }
  };
  fill(master, member, true);
  return pm.map((x) => map.get(x) || null);
}

/** {dev, ok}: max per-node slot deviation between aligned trees (px-equivalent); ok = every node within tolerance. */
export function alignedDist(pm, corr) {
  let dev = 0, ok = true;
  for (let i = 0; i < pm.length; i++) {
    const b = corr[i];
    if (!b || b === pm[i] || b.dg.M === pm[i].dg.M) continue;
    const x = ownSlots(pm[i]), y = ownSlots(b);
    const r = x.length === y.length ? slotsDistance(x, y) : slotsDistance(x.filter((s) => s.c !== 'size'), y.filter((s) => s.c !== 'size'));
    // M digests differ for descendants too, so only own slots count here
    if (!r.ok) ok = false;
    if (r.dev > dev) dev = r.dev;
  }
  return { dev, ok };
}
import { ownSlots } from '../common/hash.mjs';

// ------------------------------------------------------------------ thresholds (spec 1.5)
export function thresholdReason(c, P) {
  const tiny = c.nodes < P.tinyNodes;
  const need = tiny ? P.occTiny : P.occ;
  const crossFile = c.nodes >= P.crossFileNodes && c.occ >= P.crossFileOcc && c.files >= 2 && c.screens >= 2;
  if (c.occ < need && !crossFile) return 'occurrences';
  if (c.screens < P.screens && c.occ < P.singleScreenOcc) return 'screens';
  return null;
}

export { isAncestor };
