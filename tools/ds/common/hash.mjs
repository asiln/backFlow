// Stable hashing + the three Merkle digests of spec 1.2 (S shape, M metrics, P paints) over `view` records (view.mjs).
// Hash equality is exact; tolerance (spec 1.4) is applied on the numeric slot vectors via `slotsClose` / `paintsClose`.
import { createHash } from 'node:crypto';
import { coloursClose, parseColourKey, isColourKey, DEFAULT_TOL } from './colour.mjs';

// ---------------------------------------------------------------- canonical JSON + hashing
/** JSON with sorted object keys, no whitespace, undefined dropped, -0 -> 0, non-finite numbers -> null. */
export function canonicalJson(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Object.is(v, -0) ? 0 : v) : 'null';
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

/** sha1, truncated to `len` hex chars (default 10 as in spec 1.2). */
export const hashStr = (s, len = 10) => createHash('sha1').update(String(s)).digest('hex').slice(0, len);
export const hashJson = (v, len = 10) => hashStr(canonicalJson(v), len);
/** H([...]) of the spec: hash of a canonical list. */
export const H = (list, len = 10) => hashJson(list, len);

/** Small stable integer for a string (used to put family names into numeric slot vectors). */
export const strNum = (s) => parseInt(hashStr(s, 6), 16);

// ---------------------------------------------------------------- quantisation (spec 1.2 / 1.4)
export const q = (n) => (n == null ? 0 : Math.round(n) + 0);                 // integer
export const q2 = (n) => (n == null ? 0 : Math.round(n / 2) * 2 + 0);        // 2px grid
export const qEm = (n) => (n == null ? 0 : Math.round(n / 0.02) * 0.02 + 0); // 0.02em grid (letter spacing)
export const round2 = (n) => Math.round(n * 100) / 100 + 0;

/** Slot classes and their tolerances (spec 1.4 table). Returns the allowed |a-b| for the class. */
export function tolOf(cls, a, b) {
  switch (cls) {
    case 'gap': case 'pad': case 'stroke': case 'radius': case 'shadow': return 1;
    case 'size': return Math.max(2, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
    case 'lh': return 1;
    case 'ls': return 0.02;
    case 'font': case 'svg': case 'exact': default: return 0;
  }
}
const QUANT = { gap: q, pad: q, stroke: q, radius: q, shadow: q, size: q2, lh: q, ls: qEm, font: round2, svg: q, exact: round2 };
/** Quantise a value of a slot class for hashing. */
export const quantise = (cls, v) => (QUANT[cls] || round2)(v);

/** True iff two slot vectors ([{c,v}]) are equal slot by slot within the class tolerances. */
export function slotsClose(a, b) { return slotsDistance(a, b).ok; }

/** {ok, dev}: dev = max |a-b| over slots (px-equivalent, informational); ok = every slot within tolerance. */
export function slotsDistance(a, b) {
  if (a.length !== b.length) return { ok: false, dev: Infinity };
  let dev = 0, ok = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].c !== b[i].c) return { ok: false, dev: Infinity };
    const d = Math.abs(a[i].v - b[i].v);
    if (d > tolOf(a[i].c, a[i].v, b[i].v) + 1e-9) ok = false;
    if (d > dev) dev = d;
  }
  return { ok, dev: round2(dev) };
}

/** Paint lists ([{role,c,key}]) are close when roles match slot by slot and colours are equal / within tolerance. */
export function paintsClose(a, b, tol = {}) {
  if (a.length !== b.length) return false;
  const o = { ...DEFAULT_TOL, ...tol };
  for (let i = 0; i < a.length; i++) {
    if (a[i].role !== b[i].role) return false;
    if (a[i].key === b[i].key) continue;
    // token keys of the same family can be compared by value; a different token key is a different token unless snapped
    const x = isColourKey(a[i].key) && isColourKey(b[i].key) ? parseColourKey(a[i].key).rgba : a[i].c;
    const y = isColourKey(a[i].key) && isColourKey(b[i].key) ? parseColourKey(b[i].key).rgba : b[i].c;
    if (!coloursClose(x, y, o)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- digests
const shadowSlots = (v) => v.shadows.flatMap((s) => [
  { c: 'shadow', v: s.inset ? 1 : 0 }, { c: 'shadow', v: s.x }, { c: 'shadow', v: s.y }, { c: 'shadow', v: s.blur }, { c: 'shadow', v: s.spread },
]);

/**
 * Numeric slots of ONE node (not its children), in the fixed order the cluster step compares:
 * frame: g, g2, p[4], radius[4], strokeW[4], shadows (5 each), then w / h only on axes with sizing 'F';
 * text: size, weight, family, lh, ls; svg: w, h; img: w, h (2px grid classes).
 */
export function ownSlots(v) {
  if (v.inst) return [];
  if (v.t === 'text') {
    const t = v.text;
    return [{ c: 'font', v: t.size }, { c: 'font', v: t.weight }, { c: 'exact', v: strNum(t.family) }, { c: 'lh', v: t.lh }, { c: 'ls', v: t.size ? t.ls / t.size : 0 }];
  }
  if (v.t === 'svg') return [{ c: 'svg', v: Math.round(v.svg.w) }, { c: 'svg', v: Math.round(v.svg.h) }];
  if (v.t === 'img') return [{ c: 'size', v: v.w }, { c: 'size', v: v.h }];
  const out = [{ c: 'gap', v: v.g }, { c: 'gap', v: v.g2 }];
  v.p.forEach((x) => out.push({ c: 'pad', v: x }));
  v.radius.forEach((x) => out.push({ c: 'radius', v: x }));
  v.strokeW.forEach((x) => out.push({ c: 'stroke', v: x }));
  out.push(...shadowSlots(v));
  if (v.s[0] === 'F') out.push({ c: 'size', v: v.w });
  if (v.s[1] === 'F') out.push({ c: 'size', v: v.h });
  return out;
}

const leafS = (v) => {
  if (v.t === 'text') return 'T' + (v.text.multi ? 'm' : '1') + (v.text.trunc ? 't' : '') + (v.text.hasRuns ? 'r' : '');
  if (v.t === 'svg') return 'S';
  return 'I' + (v.img.fit || '');
};

/**
 * Merkle digest of a view subtree.
 * Returns { S, M, P, nodes, leaves, slots, paints }.
 *  - S shape: type, k, ls.s pair, abs, clip, pos, child count/order and child S; text single|multi|trunc|runs; svg 'S'; img fit;
 *    a nested instance (view.inst, built with makeView({collapse:true})) is the leaf 'C:<id>' regardless of variant.
 *  - M metrics: quantised ownSlots + children M (hash only; use `slots` + slotsClose for tolerance).
 *  - P paints: paint keys (token key when `tok` exists else quantised 8-bit RGBA, alpha grid 0.02) + opacity + children P;
 *    an instance contributes its variant map so different nested variants stay visible (spec 1.7).
 * opts.ignoreRootSizing: leave the root's own ls.s pair out of S (spec 1.2 includes it; see CONTRACT-NOTES #14).
 */
export function digestView(v, opts = {}, isRoot = true) {
  if (v.inst) {
    return {
      S: 'C:' + v.inst.id, M: H([]), P: H(['inst', v.inst.v || null]),
      nodes: 1, leaves: 1, slots: [], paints: [{ role: 'inst', c: null, key: canonicalJson(v.inst.v || null) }],
    };
  }
  const own = ownSlots(v);
  const ownM = own.map((s) => quantise(s.c, s.v));
  const ownPaints = [...v.paints, ...(v.opacity !== 1 ? [{ role: 'opacity', c: null, key: 'o:' + Math.round(v.opacity / 0.02) * 2 }] : [])];
  if (v.t !== 'frame') {
    return {
      S: leafS(v) + (v.abs ? '^' : ''), M: H(ownM), P: H(ownPaints.map((p) => p.key)),
      nodes: 1, leaves: 1, slots: own, paints: ownPaints,
    };
  }
  const ks = v.kids.map((k) => digestView(k, opts, false));
  const sizing = isRoot && opts.ignoreRootSizing ? '' : v.s.join('');
  const S = H(['F', v.k, sizing, v.abs ? 'a' : '', v.clip ? 'c' : '', v.pos ? 'p' + v.pos : '', ...ks.map((d) => d.S)]);
  const M = H([ownM, ...ks.map((d) => d.M)]);
  const P = H([ownPaints.map((p) => p.key), ...ks.map((d) => d.P)]);
  return {
    S, M, P,
    nodes: 1 + ks.reduce((a, d) => a + d.nodes, 0),
    leaves: ks.reduce((a, d) => a + d.leaves, 0),
    slots: own.concat(...ks.map((d) => d.slots)),
    paints: ownPaints.concat(...ks.map((d) => d.paints)),
  };
}

/** Shape digest only (cheap helpers for callers that need one of the three). */
export const shapeDigest = (v, opts) => digestView(v, opts).S;
export const metricDigest = (v, opts) => digestView(v, opts).M;
export const paintDigest = (v, opts) => digestView(v, opts).P;

/** Spec 5.3 / 1.9 id: 'cmp_<slug>_<hash4(S of the first accepted leader)>'. */
export function componentId(slug, S) {
  return `cmp_${String(slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}_${hashStr(S, 4)}`;
}
export function iconId(geom) { return `ic_${geom}`; }
