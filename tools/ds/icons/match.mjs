// Match library icons against the icons of the existing design system (ds-inventory.json, spec 7.3 / 3.2).
// Geometry: an inventory entry that carries `geom` is compared by hash only (exact). Entries without `geom` are compared by
// normalised name ('ChevronLeft' == 'chevron-left' == 'Icon / chevron_left'), but only against icons that were named from a
// table or hint (a hash name such as 'Icon / 1a2b3c' never matches by name).

export const normName = (s) => String(s || '').replace(/^\s*icons?\s*[\/:>-]+\s*/i, '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();

/**
 * @param {Array} icons LibIcon[] (mutated: `ds` is set on matches unless opts.mutate === false)
 * @param {{icons?: {id:string,key?:string,name:string,geom?:string}[]}} inventory
 * @param {{mutate?:boolean, isHashName?:(name:string)=>boolean}} [opts]
 * @returns {{matched:{icon:string, ds:{id?:string,name:string}, by:'geom'|'name'}[], unmatched:string[], ambiguous:{icon:string, candidates:string[]}[], stats:object}}
 */
export function matchDsIcons(icons, inventory, opts = {}) {
  const mutate = opts.mutate !== false;
  const isHash = opts.isHashName || ((n) => /^Icon \/ [0-9a-f]{4,}$/i.test(n));
  const inv = (inventory && inventory.icons) || [];
  const byGeom = new Map(), byName = new Map();
  for (const e of inv) {
    if (e.geom) { (byGeom.get(e.geom) || byGeom.set(e.geom, []).get(e.geom)).push(e); continue; }
    const k = normName(e.name);
    if (k) (byName.get(k) || byName.set(k, []).get(k)).push(e);
  }
  const matched = [], unmatched = [], ambiguous = [];
  for (const ic of icons) {
    let by = null, c = byGeom.get(ic.geom);
    if (c) by = 'geom';
    else if (!isHash(ic.name)) { c = byName.get(normName(ic.name)); if (c) by = 'name'; }
    if (!c) { unmatched.push(ic.id); continue; }
    const pick = c[0];
    if (c.length > 1) ambiguous.push({ icon: ic.id, candidates: c.map((e) => e.name) });
    const ds = { ...(pick.id ? { id: pick.id } : {}), name: pick.name };
    if (mutate) ic.ds = ds;
    matched.push({ icon: ic.id, ds, by });
  }
  return { matched, unmatched, ambiguous, stats: { icons: icons.length, matched: matched.length, byGeom: matched.filter((m) => m.by === 'geom').length, byName: matched.filter((m) => m.by === 'name').length, unmatched: unmatched.length, ambiguous: ambiguous.length } };
}
