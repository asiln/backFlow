// Memoised bottom-up Merkle digests (spec 1.2) for EVERY node of a view tree in O(N), stored on `v.dg`.
// Equivalent to digestView() of common/hash.mjs (a test asserts S, M, P and, for the `Sn` variant, S with
// ignoreRootSizing on all nodes of the fixtures), but digestView re-walks the subtree on every call (O(N * depth)).
// `Sn` = shape digest with the node's OWN ls.s pair left out: the key candidate roots are bucketed by
// (CONTRACT-NOTES #12/#20), so a hug-width and a fill-width Button share a bucket.
import { H, ownSlots, quantise, digestView } from '../common/hash.mjs';
import { canonicalJson } from '../common/hash.mjs';

const leafS = (v) => {
  if (v.t === 'text') return 'T' + (v.text.multi ? 'm' : '1') + (v.text.trunc ? 't' : '') + (v.text.hasRuns ? 'r' : '');
  if (v.t === 'svg') return 'S';
  return 'I' + (v.img.fit || '');
};

const opacityPaint = (v) => (v.opacity !== 1 ? [{ role: 'opacity', c: null, key: 'o:' + Math.round(v.opacity / 0.02) * 2 }] : []);

/** Fill v.dg = { S, Sn, M, P, nodes, leaves } on every node of the current tree; returns the root digest. */
export function digestTree(v) {
  if (v.inst) {
    return (v.dg = { S: 'C:' + v.inst.id, Sn: 'C:' + v.inst.id, M: H([]), P: H(['inst', v.inst.v || null]), nodes: 1, leaves: 1 });
  }
  const ownM = ownSlots(v).map((s) => quantise(s.c, s.v));
  const ownPaints = [...v.paints, ...opacityPaint(v)];
  if (v.t !== 'frame') {
    const sfx = v.abs ? '^' : '';
    const S = leafS(v) + sfx;
    return (v.dg = { S, Sn: S, M: H(ownM), P: H(ownPaints.map((p) => p.key)), nodes: 1, leaves: 1 });
  }
  const ks = v.kids.map(digestTree);
  const tail = [v.abs ? 'a' : '', v.clip ? 'c' : '', v.pos ? 'p' + v.pos : '', ...ks.map((d) => d.S)];
  let nodes = 1, leaves = 0;
  for (const d of ks) { nodes += d.nodes; leaves += d.leaves; }
  return (v.dg = {
    S: H(['F', v.k, v.s.join(''), ...tail]),
    Sn: H(['F', v.k, '', ...tail]),
    M: H([ownM, ...ks.map((d) => d.M)]),
    P: H([ownPaints.map((p) => p.key), ...ks.map((d) => d.P)]),
    nodes, leaves,
  });
}

/** Full slot / paint vectors of a candidate root, computed on demand (small subtrees only). */
export function fullDigest(v) {
  return digestView(v, { ignoreRootSizing: true });
}

export { canonicalJson };
