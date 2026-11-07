// Icon clustering: identical geometry first (exact `geom`), then tolerance merge of sub-pixel noise (spec 3.1 / task T5).
// Items: [{ sig, count? , ...anything }]; returns clusters [{ leader, geoms:Map(geom -> items[]), items, count }].
// Tolerance is the max absolute deviation of any coordinate in the 24-unit canonical box (default 0.1 = 0.4% of the box).

export const DEFAULT_TOL = 0.1;

/** Max |a_i - b_i|, Infinity when the vectors differ in length. */
export function maxDev(a, b) {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
}

export function clusterSigs(items, { tol = DEFAULT_TOL } = {}) {
  // 1. exact geom buckets
  const byGeom = new Map();
  for (const it of items) {
    let g = byGeom.get(it.sig.geom);
    if (!g) byGeom.set(it.sig.geom, (g = { geom: it.sig.geom, sig: it.sig, items: [] }));
    g.items.push(it);
  }
  // 2. tolerance merge inside the structural bucket (same styles + same command sequence)
  const byStruct = new Map();
  for (const g of byGeom.values()) {
    let b = byStruct.get(g.sig.struct);
    if (!b) byStruct.set(g.sig.struct, (b = []));
    b.push(g);
  }
  const clusters = [];
  for (const bucket of byStruct.values()) {
    bucket.sort((x, y) => y.items.length - x.items.length || (x.geom < y.geom ? -1 : 1));
    const local = [];
    for (const g of bucket) {
      let home = null;
      if (tol > 0) for (const c of local) if (maxDev(c.leader.sig.nums, g.sig.nums) <= tol) { home = c; break; }
      if (home) { home.geoms.set(g.geom, g.items); home.items.push(...g.items); } else {
        const c = { leader: g, geoms: new Map([[g.geom, g.items]]), items: [...g.items] };
        local.push(c);
      }
    }
    for (const c of local) { c.count = c.items.length; clusters.push(c); }
  }
  clusters.sort((x, y) => y.count - x.count || (x.leader.geom < y.leader.geom ? -1 : 1));
  return clusters;
}
