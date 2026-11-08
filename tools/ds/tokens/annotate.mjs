// Writes optional `tok` (TokRef, contract 7.1) onto the nodes of screen trees, in place (CONTRACT-NOTES 7, 11, 19).
//   annotate(files, tokensJson)  files: one parsed export file or an array of them (each with `frames`)
//   annotateTree(root, index)    one node tree (also used for `_library.json` roots by componentize.mjs)
//   buildTokIndex(tokensJson)    lookup structure, reusable across many files
// A key is written only when its token status is bound | create | review; skip / off-scale values stay literal.
// Keys of snapped members are rewritten to their leader's key. Nothing but `tok` is touched (an existing `tok` is
// replaced, or removed when the node has no live token).
import { nodeUses, walkNodes } from './extract.mjs';

const LIVE = new Set(['bound', 'create', 'review']);

export function buildTokIndex(tokens) {
  const colours = new Map();
  const simple = new Map();
  const put = (map, id, e) => { map.set(id, e); };
  for (const e of tokens.colors || []) {
    if (!LIVE.has(e.status)) continue;
    put(colours, `${e.key}|${e.role}`, e);
    for (const m of e.members || []) put(colours, `${m.key}|${e.role}`, e);
  }
  for (const list of [tokens.textStyles, tokens.radii, tokens.spacing, tokens.effects, tokens.gradients]) {
    for (const e of list || []) {
      if (!LIVE.has(e.status)) continue;
      put(simple, e.key, e);
      for (const m of e.members || []) put(simple, m.key, e);
    }
  }
  return { colours, simple };
}

/** Compute the TokRef of one node (null when it has none). */
export function tokOf(n, index) {
  const t = {};
  for (const u of nodeUses(n)) {
    if (!u.field) continue;
    const e = u.family === 'c' ? index.colours.get(`${u.key}|${u.role}`) : index.simple.get(u.key);
    if (!e) continue;
    if (u.field[0] === 'p' && u.field.length === 2) { (t.p || (t.p = [null, null, null, null]))[Number(u.field[1])] = e.key; }
    else if (u.field === 'gr') (t.gr || (t.gr = [])).push({ i: u.i, key: e.key });
    else t[u.field] = e.key;
  }
  return Object.keys(t).length ? t : null;
}

export function annotateTree(root, index) {
  const stats = { nodes: 0, annotated: 0 };
  walkNodes(root, (n) => {
    stats.nodes++;
    const t = tokOf(n, index);
    if (t) { n.tok = t; stats.annotated++; } else if (n.tok) delete n.tok;
  });
  return stats;
}

export function annotate(files, tokens) {
  const index = buildTokIndex(tokens);
  const total = { nodes: 0, annotated: 0 };
  for (const f of Array.isArray(files) ? files : [files]) {
    for (const root of (f && f.frames) || []) {
      const s = annotateTree(root, index);
      total.nodes += s.nodes; total.annotated += s.annotated;
    }
  }
  return total;
}
