// normalize.mjs: turns walker facts (`lf`) into a compact layout spec (`ls`) per node, self-verifies it with
// layout-sim.mjs, and applies the fallback ladder F0 (hug/fill) -> F1 (fixed children) -> F2 (offenders absolute) -> F3 (no auto-layout).
// Pure Node, no browser. Input: the tree the walker returned (nodes carry `lf`). Output: same tree with `ls`, `lf` removed.
//
// ls (container):  k 'H'|'V'|'W'(wrap)|'G'|'N'   lv 0..3   g g2   p [t,r,b,l]   bw [t,r,b,l] (part of p that is a drawn stroke)
//                  pa ca ac   cols rows [{t:'FLEX'|'FIXED'|'HUG',v}]  cg rg
// ls (child):      s ['F'|'H'|'L','F'|'H'|'L']   abs 1   cn [h,v]   mn [w,h]   mx [w,h]   gp [row,col,rowSpan,colSpan]   ga [h,v]   sp 1 (spacer)
// ls (text):       tx {l lh nw tr:{l} ta:'L'|'C'|'R'}
import { layoutBox } from './layout-sim.mjs';

const near = (a, b, t = 0.75) => Math.abs(a - b) <= t;
const r2 = (v) => Math.round(v * 100) / 100;
const snap = (v) => (Math.abs(v - Math.round(v)) < 0.3 ? Math.round(v) : r2(v));
const DEF = { strokeInLayout: true, spaceAround: true, grid: true, maxSpacers: 12, probeFallback: true };

export function normalize(tree, opts = {}) {
  const cfg = { ...DEF, ...opts };
  const stats = { containers: 0, levels: { 0: 0, 1: 0, 2: 0, 3: 0 }, static: 0, real: 0, wrappers: 0, spacers: 0, abs: 0, textAlignOverride: 0, hug: 0, fill: 0, fixed: 0, kinds: { H: 0, V: 0, W: 0, G: 0 }, causes: {} };
  const cause = (c) => { stats.causes[c] = (stats.causes[c] || 0) + 1; };
  const S = { cfg, stats, cause };
  prepText(tree);
  prune(tree);
  tree.ls = tree.ls || {};
  tree.ls.s = ['F', 'F'];
  solve(tree, S);
  collect(tree, stats, true);
  clean(tree);
  return { tree, stats };
}

// make text heights equal lines * line-height so Figma (explicit px line height) reproduces them
function prepText(N) {
  if (N.t === 'text' && N.lf && N.lf.t) {
    const t = N.lf.t;
    if (t.lh && t.l && !t.inp && !N.xf && Math.abs(N.h - t.l * t.lh) <= 3) N.h = r2(t.l * t.lh);
  }
  for (const c of N.children || []) prepText(c);
}

// ---------------------------------------------------------------- pruning
const VISUAL = (n) => n.fill || n.grads || n.layers || n.blur || n.bblur || n.stroke || n.radius || n.shadow || n.opacity != null || n.xf || n.blend || n.failed;
const isAbs = (k) => { const i = k.lf && k.lf.i; return !!(k.xf || (i && (i.pos === 'absolute' || i.pos === 'fixed' || i.fl))); };
const CHILDFACTS = ['wa', 'wm', 'ha', 'hs', 'np'];

function prune(N) {
  if (!N.children) return;
  for (const k of N.children) if (k.t === 'frame') prune(k);
  const out = [];
  for (const K of N.children) {
    const merged = K.t === 'frame' ? tryMerge(K) : null;
    if (merged) {
      merged.x = r2(K.x + merged.x); merged.y = r2(K.y + merged.y);
      if (merged.__widen) { merged.x = K.x; merged.w = K.w; merged.__box = 1; delete merged.__widen; }
      merged.lf = merged.lf || {};
      merged.lf.i = Object.assign({}, merged.lf.i, K.lf.i);
      for (const f of CHILDFACTS) if (K.lf[f] !== undefined) merged.lf[f] = K.lf[f];
      if (K.name && merged.t === 'frame' && /^(div|span|p|section|ul|li|a|label|form|main)$/.test(K.name) === false) merged.name = K.name;
      out.push(merged);
    } else out.push(K);
  }
  N.children = out;
}

// returns the child that should replace wrapper K, or null
function tryMerge(K) {
  if (!K.lf || !K.lf.c || K.children.length !== 1 || VISUAL(K) || K.z != null || K.pos === 'fixed') return null;
  if (isAbs(K)) return null;
  const c = K.lf.c, ch = K.children[0];
  if (c.pad.some((v) => v > 0.01) || c.bor.some((v) => v > 0.01)) return null;
  if (K.clip && !(ch.t === 'text' && ch.lf && ch.lf.t && ch.lf.t.tr)) return null;
  if (/flex|grid/.test(c.disp) && K.lf.c.disp !== 'flex' && K.lf.c.disp !== 'inline-flex') return null;
  if (ch.t === 'text') {
    const t = ch.lf && ch.lf.t;
    if (!t || t.inp) return null;
    if (!near(K.h, ch.h, 1.6) && !(t.tr)) return null;
    const hugging = near(K.w, ch.w, 1);
    if (!hugging) {
      if (/flex|grid/.test(c.disp)) return null; // flex centring etc. cannot be reproduced by widening the text
      ch.__widen = 1;
    }
    return ch;
  }
  if (near(ch.x, 0, 0.75) && near(ch.y, 0, 0.75) && near(ch.w, K.w, 0.75) && near(ch.h, K.h, 0.75) && !ch.lf?.i?.pos?.match(/absolute|fixed/)) return ch;
  return null;
}

// ---------------------------------------------------------------- helpers
const sortBy = (arr, a, b) => arr.slice().sort((p, q) => p[a] - q[a] || p[b] - q[b]);
function disjoint(sorted, P, D) { for (let i = 1; i < sorted.length; i++) if (sorted[i][P] < sorted[i - 1][P] + sorted[i - 1][D] - 0.75) return false; return true; }
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function contentBox(N) {
  const c = N.lf.c, b = c.bor, p = c.pad;
  const x = b[3] + p[3], y = b[0] + p[0];
  return { x, y, w: N.w - b[1] - b[3] - p[1] - p[3], h: N.h - b[0] - b[2] - p[0] - p[2] };
}

function remember(k) { if (!k.__o) k.__o = { x: k.x, y: k.y, w: k.w, h: k.h }; }
function restore(k) { if (k.__o) { k.x = k.__o.x; k.y = k.__o.y; k.w = k.__o.w; k.h = k.__o.h; delete k.__o; } }

// ---------------------------------------------------------------- infer a container structure
function inferStruct(N, flow, S) {
  const c = N.lf.c, cb = contentBox(N), css = c.disp || 'block';
  const isFlex = /flex/.test(css), isGrid = /grid/.test(css);
  if (isGrid && S.cfg.grid) { const g = inferGrid(N, flow, cb, S); if (g) return g; }
  const sy = sortBy(flow, 'y', 'x'), sx = sortBy(flow, 'x', 'y');
  const vOK = disjoint(sy, 'y', 'h'), hOK = disjoint(sx, 'x', 'w');
  let k = null;
  const pref = isFlex ? (/^column/.test(c.fd) ? 'V' : 'H') : (/inline/.test(css) ? 'H' : 'V');
  if (flow.length === 1) k = pref;
  else if (pref === 'H' && hOK) k = 'H';
  else if (pref === 'V' && vOK) k = 'V';
  else if (vOK && !(isFlex && hOK)) k = 'V';
  else if (hOK) k = 'H';
  if (k === 'H' && !hOK && flow.length > 1) k = null;
  if (k === 'V' && !vOK && flow.length > 1) k = null;
  if (!k) { const w = inferWrap(N, flow, cb, S); return w; }
  return inferStack(N, flow, cb, S, k, isFlex, c);
}

function inferStack(N, flow, cb, S, k, isFlex, c) {
  const H = k === 'H';
  const P = H ? 'x' : 'y', PD = H ? 'w' : 'h', Cx = H ? 'y' : 'x', CD = H ? 'h' : 'w';
  const items = sortBy(flow, P, Cx);
  const cbP0 = H ? cb.x : cb.y, cbPn = H ? cb.w : cb.h, cbC0 = H ? cb.y : cb.x, cbCn = H ? cb.h : cb.w;
  const n = items.length;
  const gaps = []; for (let i = 1; i < n; i++) gaps.push(Math.max(0, items[i][P] - items[i - 1][P] - items[i - 1][PD]));
  const lead = items[0][P] - cbP0, trail = cbP0 + cbPn - (items[n - 1][P] + items[n - 1][PD]);
  const cssGap = isFlex || /grid/.test(c.disp) ? (H ? c.cg : c.rg) || 0 : 0;
  const jc = isFlex ? c.jc : '';
  let pa = 'MIN', gap = 0, padP0 = 0, padPn = 0, spacers = [];
  const meanGap = gaps.length ? gaps.reduce((a, v) => a + v, 0) / gaps.length : 0;
  const equalGaps = gaps.every((g) => near(g, meanGap, 0.75));
  const freeExtra = gaps.reduce((a, v) => a + v, 0) - cssGap * gaps.length;
  let done = false;
  if (n >= 2 && isFlex && /space-(between|around|evenly)/.test(jc) && equalGaps && freeExtra > 1) {
    const extra = meanGap - cssGap;
    if (/between/.test(jc) && near(lead, 0, 1) && near(trail, 0, 1)) { pa = 'SPACE_BETWEEN'; gap = snap(cssGap); done = true; }
    else if (S.cfg.spaceAround && /around/.test(jc) && near(lead, extra / 2, 1.2) && near(trail, extra / 2, 1.2)) { pa = 'SPACE_AROUND'; gap = snap(cssGap); done = true; }
    else if (S.cfg.spaceAround && /evenly/.test(jc) && near(lead, extra, 1.2) && near(trail, extra, 1.2)) { pa = 'SPACE_EVENLY'; gap = snap(cssGap); done = true; }
  }
  if (!done) {
    if (!gaps.length) gap = snap(cssGap);
    else if (equalGaps) gap = snap(meanGap);
    else {
      // itemSpacing m plus spacer frames: a spacer between two items adds m on both sides, so g = 2m + spacer
      const cl = [];
      for (const g of gaps) { const c = cl.find((q) => near(q.v, g, 0.75)); if (c) { c.n++; c.v = (c.v * (c.n - 1) + g) / c.n; } else cl.push({ v: g, n: 1 }); }
      const cands = cl.sort((a, b) => b.n - a.n || a.v - b.v).map((c) => snap(c.v)).concat([0]);
      let best = null;
      for (const m of cands) {
        const feas = gaps.every((g) => near(g, m, 0.75) || g >= 2 * m + 0.5);
        if (!feas) continue;
        const cost = gaps.filter((g) => !near(g, m, 0.75)).length;
        if (!best || cost < best.cost) best = { m, cost };
      }
      gap = best.m;
    }
    gaps.forEach((g, i) => { if (!near(g, gap, 0.75) && g - 2 * gap > 0.4) spacers.push({ before: items[i + 1], size: r2(g - 2 * gap) }); });
    if (lead < -0.75) { pa = 'MIN'; padP0 = lead; } // child pokes into the padding (negative margin): shrink the start padding
    else if (trail < -0.75 && near(lead, 0, 0.75)) { pa = 'MIN'; padPn = trail; }
    else if (near(lead, 0, 0.75)) pa = 'MIN';
    else if (near(trail, 0, 0.75)) pa = 'MAX';
    else if (near(lead, trail, 1.5) && n >= 1) pa = 'CENTER';
    else { pa = 'MIN'; padP0 = lead; }
    if (pa === 'MAX' && !near(trail, 0, 0.75)) padPn = trail;
  }
  if (spacers.length > S.cfg.maxSpacers) return null;
  // counter axis
  const cls = (it, r0, rn) => { // class of an item relative to the counter region
    const off = it[Cx] - r0, free = rn - it[CD];
    const o = [];
    if (near(it[CD], rn, 0.75)) o.push('MIN', 'CENTER', 'MAX');
    else { if (near(off, 0, 0.75)) o.push('MIN'); if (near(off, free, 0.75)) o.push('MAX'); if (near(off, free / 2, 1)) o.push('CENTER'); }
    return o;
  };
  let r0 = cbC0, rn = cbCn;
  const score = { MIN: 0, CENTER: 0, MAX: 0 };
  for (const it of items) for (const o of cls(it, r0, rn)) score[o]++;
  const hint = isFlex ? c.ai : '';
  const hintCls = /center/.test(hint) ? 'CENTER' : /(end|bottom)/.test(hint) ? 'MAX' : 'MIN';
  let ca = ['MIN', 'CENTER', 'MAX'].sort((a, b) => score[b] - score[a] || (a === hintCls ? -1 : b === hintCls ? 1 : 0))[0];
  let padC0 = 0, padCn = 0;
  if (score[ca] < n) {
    // maybe everything is shifted by a common offset (margin / padding mismatch): absorb it into padding
    const offs = items.filter((it) => !near(it[CD], rn, 0.75)).map((it) => { const off = it[Cx] - r0, free = rn - it[CD]; return ca === 'MIN' ? off : ca === 'MAX' ? free - off : off - free / 2; });
    const md = median(offs);
    if (offs.length === items.length && Math.abs(md) > 0.75 && offs.every((v) => near(v, md, 1))) {
      if (ca === 'MIN') padC0 = md; else if (ca === 'MAX') padCn = md; else if (md > 0) padC0 = 2 * md; else padCn = -2 * md;
      r0 = cbC0 + padC0; rn = cbCn - padC0 - padCn;
    }
  }
  const odd = items.filter((it) => !cls(it, r0, rn).includes(ca));
  const pad = c.pad.map((v, i) => v + c.bor[i]);
  const pP = H ? [3, 1] : [0, 2], pC = H ? [0, 2] : [3, 1];
  const p = pad.slice();
  p[pP[0]] += padP0; p[pP[1]] += padPn; p[pC[0]] += padC0; p[pC[1]] += padCn;
  return { k, items, gap, spacers, pa, ca, p: p.map(r2), odd, H, P, PD, Cx, CD, r0, rn, cb, cbC0, cbCn, lead, trail };
}

function inferWrap(N, flow, cb, S) {
  if (flow.length < 3) return null;
  const c = N.lf.c;
  const items = sortBy(flow, 'y', 'x'); const rows = [];
  for (const it of items) {
    const cy = it.y + it.h / 2; const row = rows[rows.length - 1];
    if (row && cy < row.bot - 0.01 && cy > row.top + 0.01) { row.items.push(it); row.top = Math.min(row.top, it.y); row.bot = Math.max(row.bot, it.y + it.h); }
    else rows.push({ items: [it], top: it.y, bot: it.y + it.h });
  }
  if (rows.length < 2 || rows.length > 40) return null;
  for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bot - 0.75) return null;
  for (const r of rows) { r.items.sort((a, b) => a.x - b.x); if (!disjoint(r.items, 'x', 'w')) return null; }
  const cgs = [], rgs = [];
  for (const r of rows) for (let i = 1; i < r.items.length; i++) cgs.push(r.items[i].x - r.items[i - 1].x - r.items[i - 1].w);
  for (let i = 1; i < rows.length; i++) rgs.push(rows[i].top - rows[i - 1].bot);
  const cgm = cgs.length ? cgs.reduce((a, v) => a + v, 0) / cgs.length : (c.cg || 0), rgm = rgs.reduce((a, v) => a + v, 0) / rgs.length;
  if (!cgs.every((g) => near(g, cgm, 0.75)) || !rgs.every((g) => near(g, rgm, 0.75))) return null;
  const leads = rows.map((r) => r.items[0].x - cb.x), trails = rows.map((r) => cb.x + cb.w - (r.items[r.items.length - 1].x + r.items[r.items.length - 1].w));
  let pa;
  if (leads.every((v) => near(v, 0, 0.75))) pa = 'MIN';
  else if (trails.every((v) => near(v, 0, 0.75))) pa = 'MAX';
  else if (leads.every((v, i) => near(v, trails[i], 1.5))) pa = 'CENTER';
  else return null;
  for (const r of rows) { r.h = r.bot - r.top; }
  const score = { MIN: 0, CENTER: 0, MAX: 0 };
  for (const r of rows) for (const it of r.items) { const off = it.y - r.top, free = r.h - it.h; if (near(off, 0, 0.75)) score.MIN++; if (near(off, free / 2, 1)) score.CENTER++; if (near(off, free, 0.75)) score.MAX++; }
  const ca = ['MIN', 'CENTER', 'MAX'].sort((a, b) => score[b] - score[a])[0];
  const out = [];
  for (const r of rows) out.push(...r.items);
  return { k: 'W', items: out, gap: snap(cgm), gap2: snap(rgm), spacers: [], pa, ca, p: c.pad.map((v, i) => r2(v + c.bor[i])), odd: [], cb };
}

function parseTracks(str) {
  if (!str || str === 'none') return null;
  const t = str.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const px = t.map((v) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : NaN));
  return px.length && px.every((v) => !isNaN(v)) ? px : null;
}

function inferGrid(N, flow, cb, S) {
  const c = N.lf.c, lf = N.lf;
  const cols = parseTracks(c.gtc), rows = parseTracks(c.gtr);
  if (!cols || !rows || cols.length > 12 || rows.length > 60) return null;
  const cols2 = parseTracks(lf.gtc2);
  const cg = c.cg || 0, rg = c.rg || 0;
  const hugW = N.ls && N.ls.s && N.ls.s[0] === 'H', hugH = N.ls && N.ls.s && N.ls.s[1] === 'H';
  // track ranges, visual order (left to right)
  const ranges = []; let cur = c.rtl ? cb.x + cb.w : cb.x;
  cols.forEach((w, i) => {
    const flex = cols2 && cols2.length === cols.length && cols2[i] - w > 1;
    if (c.rtl) { ranges.push({ x0: cur - w, x1: cur, w, flex }); cur -= w + cg; } else { ranges.push({ x0: cur, x1: cur + w, w, flex }); cur += w + cg; }
  });
  ranges.sort((a, b) => a.x0 - b.x0);
  const rr = []; cur = cb.y; rows.forEach((h) => { rr.push({ y0: cur, y1: cur + h, h }); cur += h + rg; });
  const placed = []; const taken = new Set();
  for (const it of flow) {
    const ci = ranges.map((r, i) => (Math.min(r.x1, it.x + it.w) - Math.max(r.x0, it.x) > 0.5 ? i : -1)).filter((i) => i >= 0);
    const ri = rr.map((r, i) => (Math.min(r.y1, it.y + it.h) - Math.max(r.y0, it.y) > 0.5 ? i : -1)).filter((i) => i >= 0);
    if (!ci.length || !ri.length) return null;
    if (ci[ci.length - 1] - ci[0] + 1 !== ci.length || ri[ri.length - 1] - ri[0] + 1 !== ri.length) return null;
    for (const r of ri) for (const cc of ci) { const key = r + ',' + cc; if (taken.has(key)) return null; taken.add(key); }
    placed.push({ it, gp: [ri[0], ci[0], ri.length, ci.length] });
  }
  placed.sort((a, b) => a.gp[0] - b.gp[0] || a.gp[1] - b.gp[1]);
  const minFlex = Math.min(...ranges.filter((r) => r.flex).map((r) => r.w), Infinity);
  const colDefs = ranges.map((r) => (r.flex && !hugW ? { t: 'FLEX', v: r2(r.w / minFlex) } : { t: 'FIXED', v: r2(r.w) }));
  const rowDefs = rr.map((r, i) => {
    const single = placed.filter((p) => p.gp[0] === i && p.gp[2] === 1);
    const tallest = single.reduce((m, p) => Math.max(m, p.it.h), 0);
    return single.length && near(tallest, r.h, 0.75) ? { t: 'HUG' } : { t: 'FIXED', v: r2(r.h) };
  });
  const gridItems = placed.map((p) => {
    const cell = { x: ranges[p.gp[1]].x0, w: ranges[p.gp[1] + p.gp[3] - 1].x1 - ranges[p.gp[1]].x0, y: rr[p.gp[0]].y0, h: rr[p.gp[0] + p.gp[2] - 1].y1 - rr[p.gp[0]].y0 };
    const al = (off, free) => (near(off, 0, 0.75) ? 'MIN' : near(off, free, 0.75) ? 'MAX' : near(off, free / 2, 1) ? 'CENTER' : 'MIN');
    p.ga = [al(p.it.x - cell.x, cell.w - p.it.w), al(p.it.y - cell.y, cell.h - p.it.h)];
    p.cell = cell; return p;
  });
  return { k: 'G', items: gridItems.map((p) => p.it), grid: gridItems, cols: colDefs, rows: rowDefs, cg, rg, gap: 0, spacers: [], pa: 'MIN', ca: 'MIN', p: c.pad.map((v, i) => r2(v + c.bor[i])), odd: [], cb };
}

// ---------------------------------------------------------------- sizing intents
function textInfo(T) {
  const t = (T.lf && T.lf.t) || {};
  return t;
}

function intentOf(K, N, st, S) {
  const lf = K.lf || {}, i = lf.i || {};
  const kind = st.k;
  if (K.lf && K.lf.synthetic) return K.ls.s;
  if (K.t === 'text') {
    const t = textInfo(K);
    if (t.inp) return ['L', 'F'];
    let w;
    if (K.__box) w = 'L';
    else if (t.tr && t.tr.on) w = 'L';
    else if (t.nw || t.l <= 1) w = 'H';
    else w = 'L';
    if (kind === 'W' && w === 'L') w = 'F';
    return [w, 'H'];
  }
  if (K.t !== 'frame') return ['F', 'F'];
  const flexParent = /flex/.test(N.lf.c.disp);
  const cb = st.cb;
  let sw, sh;
  const noProbe = lf.np || lf.wa == null;
  const grow = flexParent && i.fg > 0;
  if (noProbe) {
    sw = (kind === 'V' && near(K.w, cb.w, 0.75)) || (kind === 'H' && grow) ? 'L' : 'F';
    sh = kind === 'V' && grow ? 'L' : 'F';
  } else {
    if (kind === 'H' && grow) sw = 'L';
    else if (flexParent && kind === 'H' && i.fb && i.fb !== 'auto' && !grow) sw = 'F';
    else if (!near(lf.wa, K.w)) sw = 'F';
    else if (i.mx && i.mx[0] != null && near(i.mx[0], K.w, 0.75) && kind !== 'H') sw = 'L';
    else if (near(lf.wm, K.w)) sw = (kind === 'V' && near(K.w, cb.w, 0.75) && !/inline/.test((K.lf.c && K.lf.c.disp) || '')) ? 'L' : 'H';
    else sw = 'L';
    if (kind === 'V' && grow && flexParent) sh = 'L';
    else if (!near(lf.ha, K.h)) sh = 'F';
    else if (lf.hs != null && lf.hs < K.h - 0.75) sh = 'L';
    else sh = 'H';
  }
  if (kind === 'W') { if (sw === 'L') sw = 'F'; if (sh === 'L') sh = 'F'; }
  return [sw, sh];
}

// ---------------------------------------------------------------- build the box tree for the simulator
function toBox(n) {
  const ls = n.ls || {};
  const b = { w: n.w, h: n.h, x: n.x, y: n.y, node: n };
  if (ls.s) { b.sw = ls.s[0]; b.sh = ls.s[1]; } else { b.sw = 'F'; b.sh = 'F'; }
  if (ls.abs) b.abs = true;
  if (ls.mn) b.mn = ls.mn; if (ls.mx) b.mx = ls.mx;
  if (ls.gp) b.gp = ls.gp; if (ls.ga) b.ga = ls.ga;
  if (n.t === 'text') { b.leaf = true; b.text = true; b.nw = n.w; b.nh = n.h; return b; }
  if (n.t !== 'frame' || !n.children || !n.children.length || !ls.k || ls.k === 'N') {
    if (n.t === 'frame' && n.children && n.children.length) { b.lm = 'N'; b.kids = n.children.map(toBox); return b; }
    b.leaf = true; return b;
  }
  b.lm = ls.k === 'W' ? 'H' : ls.k; b.wrap = ls.k === 'W';
  b.gap = ls.g || 0; b.gap2 = ls.g2 || 0; b.pad = ls.p || [0, 0, 0, 0];
  b.pa = ls.pa; b.ca = ls.ca; b.ac = ls.ac; b.cols = ls.cols; b.rows = ls.rows; b.cg = ls.cg; b.rg = ls.rg;
  b.kids = n.children.map(toBox);
  return b;
}

const isBox = (k) => k.__box || (k.ls && k.ls.tx_ta);
function check(N, S) {
  const bad = [];
  const box = toBox(N);
  layoutBox(box, N.w, N.h);
  let hugSeen = 0;
  for (const kb of box.kids) {
    const k = kb.node; if (k.ls && k.ls.abs) continue;
    const P = 1.5 + Math.min(2.5, 0.6 * hugSeen); // rounding of hugged sizes accumulates along the flow
    if (k.ls && k.ls.s && (k.ls.s[0] === 'H' || k.ls.s[1] === 'H')) hugSeen++;
    let ok;
    if (k.ls && k.ls.sp) ok = N.ls.k === 'H' ? near(kb.rx, k.x, 1.5) && near(kb.rw, k.w, 1.5) : near(kb.ry, k.y, 1.5) && near(kb.rh, k.h, 1.5);
    else if (k.t === 'text' && k.ls && k.ls.s && k.ls.s[0] === 'L' && !isBox(k)) ok = near(kb.ry, k.y, P + 0.5) && near(kb.rh, k.h, 2.2);
    else {
      const t = k.t === 'text' ? 2.2 : 1.6 + (k.ls && k.ls.s && k.ls.s.includes('H') ? Math.min(3, 0.4 * (k.children || []).length) : 0);
      ok = near(kb.rx, k.x, P) && near(kb.ry, k.y, P) && near(kb.rw, k.w, t) && near(kb.rh, k.h, t);
    }
    if (!ok) { k.__sim = [kb.rx, kb.ry, kb.rw, kb.rh]; bad.push(k); }
  }
  return { ok: !bad.length, bad };
}

function naturalOK(N) {
  const s = N.ls.s; const out = [true, true];
  if (s[0] !== 'H' && s[1] !== 'H') return out;
  const box = toBox(N);
  layoutBox(box, s[0] === 'H' ? null : N.w, s[1] === 'H' ? null : N.h);
  const tol = 1.5 + Math.min(2.5, 0.4 * (N.children || []).length);
  if (s[0] === 'H') out[0] = near(box.rw, N.w, tol);
  if (s[1] === 'H') out[1] = near(box.rh, N.h, tol);
  return out;
}

// ---------------------------------------------------------------- the solver
function synthFrame(name, x, y, w, h, fd) {
  return { t: 'frame', name, x: r2(x), y: r2(y), w: r2(w), h: r2(h), children: [], lf: { synthetic: 1, i: {}, c: { disp: 'flex', fd, fw: 'nowrap', pad: [0, 0, 0, 0], bor: [0, 0, 0, 0] } }, ls: {} };
}

function constraintsFor(K, N) {
  const i = (K.lf && K.lf.i) || {}, ins = i.ins, use = ins && (i.pos === 'fixed' || i.cbp);
  const axis = (a, b, pos, size, total, an, bn) => {
    const A = pos, B = total - (pos + size);
    if (use && ins[an] && ins[bn]) return 'STRETCH';
    if (near(A, B, 1) && A > 2) return 'CENTER';
    if (use && ins[an] && !ins[bn]) return 'MIN';
    if (use && ins[bn] && !ins[an]) return 'MAX';
    if (!use && A <= 1 && B <= 1) return 'STRETCH';
    return B < A ? 'MAX' : 'MIN';
  };
  return [axis('l', 'r', K.x, K.w, N.w, 'left', 'right'), axis('t', 'b', K.y, K.h, N.h, 'top', 'bottom')];
}

function setSizing(K, s) { K.ls = K.ls || {}; K.ls.s = s; }

function solve(N, S) {
  if (N.__solved) return;
  N.__solved = 1;
  N.ls = N.ls || {};
  N.ls.s = N.ls.s || ['F', 'F'];
  const kids0 = N.__kids0 || (N.__kids0 = N.children || []);
  const ls = N.ls;
  if (N.t !== 'frame' || !kids0.length || !N.lf || !N.lf.c) {
    if (N.t === 'frame') { ls.k = 'N'; if (ls.s) ls.s = ls.s.map((v) => (v === 'H' ? 'F' : v)); }
    if (N.t === 'text') textLs(N);
    if (N.lf && N.lf.i) applyMinMax(N);
    return;
  }
  if (N.lf.i) applyMinMax(N);
  const absK = kids0.filter(isAbs);
  let flow = kids0.filter((k) => !isAbs(k));
  const apply = (lvl, st, offenders) => {
    // reset geometry mutations of previous attempt
    for (const k of kids0) { if (!N.lf.synthetic) restore(k); if (k.ls) { delete k.ls.abs; delete k.ls.cn; delete k.ls.gp; delete k.ls.ga; delete k.ls.sp; if (!N.lf.synthetic) delete k.ls.tx_ta; } }
    ls.k = st.k; ls.g = st.gap || 0; ls.g2 = st.gap2 || 0; ls.p = st.p; ls.pa = st.pa; ls.ca = st.ca;
    if (st.k === 'G') { ls.cols = st.cols; ls.rows = st.rows; ls.cg = st.cg; ls.rg = st.rg; }
    ls.bw = N.stroke ? N.stroke.w.map(r2) : [0, 0, 0, 0];
    ls.lv = lvl;
    const hugS = [ls.s[0] === 'H', ls.s[1] === 'H'];
    const children = [];
    const items = st.items;
    const fixedKids = lvl >= 1;
    const fill = (K, its) => {
      let s = intentOf(K, N, st, S);
      if (fixedKids) s = K.t === 'text' ? (textInfo(K).l > 1 || K.__box ? ['F', 'H'] : ['F', 'F']) : ['F', 'F'];
      else {
        // legalise against a hugging parent
        const ax = st.k === 'H' || st.k === 'W' ? 0 : 1; // primary axis index
        for (let a = 0; a < 2; a++) if (s[a] === 'L' && hugS[a]) s[a] = K.t === 'text' && a === 0 && textInfo(K).l <= 1 ? 'H' : 'F';
        void ax;
      }
      setSizing(K, s);
    };
    // text alignment overrides + wrappers for counter-axis odd items
    const oddSet = new Set(st.odd || []);
    const spacerBefore = new Map((st.spacers || []).map((sp) => [sp.before, sp.size]));
    for (const K of items) {
      let node = K;
      if (K.ls) { delete K.ls.sp; }
      K.ls = K.ls || {};
      fill(K, items);
      if (oddSet.has(K)) {
        const taOK = K.t === 'text' && st.k === 'V' && !textInfo(K).inp;
        if (taOK) {
          remember(K);
          const cls = ((K.x - st.r0) < 0.75 ? 'L' : near(K.x - st.r0, st.rn - K.w, 0.75) ? 'R' : 'C');
          const clsReal = near(K.x + K.w / 2, st.r0 + st.rn / 2 + 0, 1.2) ? 'C' : (K.x - st.r0 < st.rn - (K.x - st.r0) - K.w ? 'L' : 'R');
          void cls;
          K.ls.tx_ta = clsReal; K.x = r2(st.cb.x); K.w = r2(st.cb.w);
          K.ls.s = [K.ls.s[0] === 'F' ? 'F' : 'L', K.ls.s[1]];
          S.stats.textAlignOverride++;
        } else {
          remember(K);
          const V = st.k === 'V';
          const w = V ? synthFrame('align', st.cb.x, K.y, st.cb.w, K.h, 'row') : synthFrame('align', K.x, st.cb.y, K.w, st.cb.h, 'column');
          w.ls.s = fixedKids ? ['F', 'F'] : V ? ['L', 'H'] : ['H', 'L'];
          w.lf.i = {};
          K.x = r2(K.x - w.x); K.y = r2(K.y - w.y);
          w.children = [K]; w.__kids0 = null;
          node = w; S.stats.wrappers++;
        }
      }
      if (st.k === 'G') { const p = st.grid.find((g) => g.it === K); K.ls.gp = p.gp; K.ls.ga = p.ga; }
      const sz = spacerBefore.get(K);
      if (sz && st.k !== 'G') {
        const V = st.k === 'V';
        const m0 = st.gap || 0;
        const sp = V ? synthFrame('gap', st.cb.x, K.y - m0 - sz, 1, sz, 'row') : synthFrame('gap', K.x - m0 - sz, st.cb.y, sz, 1, 'column');
        sp.ls = { sp: 1, s: ['F', 'F'] };
        children.push(sp); S.stats.spacers++;
      }
      children.push(node);
    }
    // absolute children go last (painted on top) except negative z
    const absSorted = absK.concat(offenders || []).sort((a, b) => ((a.lf?.i?.z) || 0) - ((b.lf?.i?.z) || 0));
    // CSS paint order: a positioned child with z-index auto paints in DOM order among positioned siblings,
    // so it sits BEHIND any later positioned flow sibling (e.g. a fixed background before a `relative` main).
    const domIdx = (k) => kids0.indexOf(k);
    const behindLater = (k) => !(k.lf?.i?.z) && flow.some((f) => domIdx(f) > domIdx(k) && /relative|sticky|absolute|fixed/.test(f.lf?.i?.pos || ''));
    const negs = absSorted.filter((k) => (k.lf?.i?.z || 0) < 0 || behindLater(k)), pos = absSorted.filter((k) => !((k.lf?.i?.z || 0) < 0 || behindLater(k)));
    for (const A of [...negs, ...pos]) { A.ls = A.ls || {}; A.ls.abs = 1; A.ls.s = ['F', 'F']; A.ls.cn = constraintsFor(A, N); S.stats.abs++; }
    N.children = [...negs, ...children, ...pos];
  };
  const recurseKids = () => {
    for (const k of N.children) {
      if (k.ls && k.ls.sp) continue;
      if (k.t === 'frame') solve(k, S); else if (k.t === 'text') textLs(k);
      if (k.lf && k.lf.i) applyMinMax(k);
    }
  };

  // inflow count 0 -> static container
  if (!flow.length) {
    ls.k = 'N'; ls.lv = 0; ls.static = 1;
    for (const k of kids0) { k.ls = k.ls || {}; delete k.ls.s; k.ls.cn = constraintsFor(k, N); }
    N.children = kids0.slice();
    for (const k of kids0) if (k.t === 'frame') solve(k, S); else if (k.t === 'text') textLs(k);
    for (const k of kids0) if (k.lf && k.lf.i) applyMinMax(k);
    ls.s = ls.s.map((v) => (v === 'H' ? 'F' : v));
    return;
  }

  let offenders = [];
  let st = null, lvl = 0, result = null;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    const fl = flow.filter((k) => !offenders.includes(k));
    st = fl.length ? inferStruct(N, fl, S) : null;
    if (!st) { S.cause('noStruct'); break; }
    apply(attempt === 0 ? 0 : 2, st, offenders);
    recurseKids();
    let r = check(N, S);
    if (!r.ok && S.cfg.debug) S.cfg.debug(N, attempt, 'F0', r.bad, st);
    if (r.ok) { result = { lvl: attempt === 0 ? 0 : 2 }; break; }
    if (attempt === 0) {
      // F1: children fixed
      for (const K of N.children) if (!(K.ls && (K.ls.abs || K.ls.sp))) K.ls.s = K.t === 'text' ? (textInfo(K).l > 1 || K.__box ? ['F', 'H'] : ['F', 'F']) : ['F', 'F'];
      ls.lv = 1;
      r = check(N, S);
      if (!r.ok && S.cfg.debug) S.cfg.debug(N, attempt, 'F1', r.bad, st);
      if (r.ok) { result = { lvl: 1 }; break; }
    }
    // F2: offenders become absolute (only real, non-synthetic kids that are not spacers)
    const real = r.bad.filter((k) => !(k.ls && k.ls.sp)).map((k) => (k.lf && k.lf.synthetic && k.children[0] ? k.children[0] : k));
    const uniq = [...new Set(real)].filter((k) => kids0.includes(k));
    if (!uniq.length || uniq.length > Math.max(2, flow.length * 0.34)) { S.cause('tooManyOffenders'); break; }
    offenders = offenders.concat(uniq);
    S.cause('offender');
  }
  if (!result) {
    // F3: no auto-layout. Restore geometry; kids keep absolute coordinates.
    for (const k of kids0) { if (!N.lf.synthetic) restore(k); if (k.ls) { delete k.ls.s; delete k.ls.abs; delete k.ls.cn; delete k.ls.gp; delete k.ls.ga; delete k.ls.sp; delete k.ls.tx_ta; } }
    for (const k of kids0) { k.ls = k.ls || {}; delete k.ls.s; }
    N.children = kids0.slice();
    ls.k = 'N'; ls.lv = 3; delete ls.g; delete ls.g2; delete ls.p; delete ls.pa; delete ls.ca; delete ls.cols; delete ls.rows;
    ls.s = ls.s.map((v) => (v === 'H' ? 'F' : v));
    for (const k of N.children) { if (k.t === 'frame') solve(k, S); else if (k.t === 'text') textLs(k); }
    for (const k of N.children) { if (isAbs(k)) { k.ls.cn = constraintsFor(k, N); } }
    return;
  }
  ls.lv = result.lvl;
  // self hugging: natural size must equal the measured size, otherwise this axis is FIXED
  const nat = naturalOK(N);
  if (!nat[0]) { ls.s[0] = 'F'; S.cause('hugW'); }
  if (!nat[1]) { ls.s[1] = 'F'; S.cause('hugH'); }
}

function applyMinMax(K) {
  const i = K.lf && K.lf.i; if (!i) return;
  K.ls = K.ls || {};
  if (i.mn) K.ls.mn = i.mn; if (i.mx) K.ls.mx = i.mx;
}

function textLs(T) {
  T.ls = T.ls || {};
  const t = textInfo(T);
  const tx = {};
  if (t.l) tx.l = t.l;
  if (t.lh) tx.lh = t.lh;
  if (t.nw) tx.nw = 1;
  if (t.tr) tx.tr = t.tr.l;
  if (T.ls.tx_ta) tx.ta = T.ls.tx_ta;
  if (T.__box || T.ls.tx_ta) tx.bx = 1;
  T.ls.tx = tx;
}

// ---------------------------------------------------------------- stats + cleanup
function collect(N, stats, isRoot) {
  if (N.t === 'frame' && N.children && N.children.length && N.ls && N.ls.k) {
    const real = N.children.some((c) => !(c.ls && (c.ls.abs || c.ls.sp)));
    if (N.ls.static || !real) stats.static++;
    else {
      stats.containers++;
      stats.levels[N.ls.lv ?? 3]++;
      if (N.ls.k !== 'N' && N.ls.lv === 0) { stats.real++; }
      if (stats.kinds[N.ls.k] != null) stats.kinds[N.ls.k]++;
    }
  }
  if (N.ls && N.ls.s && !isRoot) for (const v of N.ls.s) { if (v === 'H') stats.hug++; else if (v === 'L') stats.fill++; else stats.fixed++; }
  for (const c of N.children || []) collect(c, stats, false);
}

function clean(N) {
  delete N.lf; delete N.__sim; delete N.__o; delete N.__kids0; delete N.__box; delete N.__widen; delete N.__solved;
  if (N.ls) { delete N.ls.static; if (N.ls.tx_ta) delete N.ls.tx_ta; if (N.ls.lv === undefined && N.ls.k === 'N' && !N.ls.s) delete N.ls.k; }
  if (N.ls && !Object.keys(N.ls).length) delete N.ls;
  for (const c of N.children || []) clean(c);
}

export function summarize(stats) {
  const t = stats.containers || 1;
  const pc = (v) => Math.round((100 * v) / t);
  return { containers: stats.containers, F0: pc(stats.levels[0]), F1: pc(stats.levels[1]), F2: pc(stats.levels[2]), F3: pc(stats.levels[3]), staticContainers: stats.static, kinds: stats.kinds, wrappers: stats.wrappers, spacers: stats.spacers, abs: stats.abs, sizing: { hug: stats.hug, fill: stats.fill, fixed: stats.fixed }, causes: stats.causes };
}
