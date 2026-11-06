// Tiny auto-layout engine that mimics what Figma does with the properties we set (HORIZONTAL/VERTICAL, wrap, GRID,
// FIXED/HUG/FILL children, ABSOLUTE children, min/max). Used by normalize.mjs (self-verification) and plugin-mock.mjs.
// It models documented behaviour only; it is NOT Figma.
//
// Box: {
//   lm: 'N'|'H'|'V'|'G', wrap?, gap?, gap2?, pad?:[t,r,b,l], pa?: MIN|CENTER|MAX|SPACE_BETWEEN|SPACE_AROUND|SPACE_EVENLY,
//   ca?: MIN|CENTER|MAX, ac?: AUTO|SPACE_BETWEEN, cols?, rows?: [{t:'FLEX'|'FIXED'|'HUG', v}], cg?, rg?,
//   w, h            // measured/fixed size (used by sizing 'F'); x, y (for N layout and absolute kids)
//   leaf?, text?, nw?, nh?, thFn?(w)=>h     // natural size of leaves
//   kids?: Box[]
//   // as a child:
//   sw, sh: 'F'|'H'|'L', abs?, mn?:[w,h], mx?:[w,h], gp?:[row,col,rowSpan,colSpan], ga?:[h,v]
// }
// layoutBox(box, W, H) (W/H null = hug) assigns rw, rh to the box and rx, ry, rw, rh to every descendant.
const clamp = (v, lo, hi) => Math.min(hi == null ? Infinity : hi, Math.max(lo == null ? -Infinity : lo, v));
const lim = (k, a, v) => clamp(v, k.mn ? k.mn[a] : null, k.mx ? k.mx[a] : null);
const DIM = ['w', 'h'], SZ = ['sw', 'sh'];

// pure + memoised: {w, h, rects:[{k,x,y,w,h}]}
function lay(b, W, H) {
  const key = W + '|' + H;
  const m = b.__m || (b.__m = new Map());
  if (m.has(key)) return m.get(key);
  const res = compute(b, W, H);
  m.set(key, res);
  return res;
}
const size = (k, w, h) => { const r = lay(k, w, h); return { w: r.w, h: r.h }; };

export function layoutBox(b, W, H) {
  const res = lay(b, W, H);
  b.rw = res.w; b.rh = res.h;
  for (const r of res.rects) { r.k.rx = r.x; r.k.ry = r.y; layoutBox(r.k, r.w, r.h); }
  return { w: res.w, h: res.h };
}

function compute(b, W, H) {
  const kids = b.kids || [];
  if (b.leaf || (!kids.length && b.lm !== 'G')) {
    const w = W != null ? W : (b.nw != null ? b.nw : b.w);
    const h = H != null ? H : (b.text && b.thFn ? b.thFn(w) : (b.nh != null ? b.nh : b.h));
    return { w, h, rects: [] };
  }
  if (b.lm === 'N' || !b.lm) {
    return { w: W != null ? W : b.w, h: H != null ? H : b.h, rects: kids.map((k) => ({ k, x: k.x || 0, y: k.y || 0, w: k.w, h: k.h })) };
  }
  const [pt, pr, pb, pl] = b.pad || [0, 0, 0, 0];
  const padXY = [pl + pr, pt + pb], padStart = [pl, pt];
  const inner = [W != null ? W - padXY[0] : null, H != null ? H - padXY[1] : null];
  const absK = kids.filter((k) => k.abs), flow = kids.filter((k) => !k.abs);
  let out;
  if (b.lm === 'G') out = grid(b, flow, inner, padXY, padStart);
  else if (b.wrap && b.lm === 'H') out = wrap(b, flow, inner, padXY, padStart);
  else out = stack(b, flow, inner, padXY, padStart);
  for (const k of absK) out.rects.push({ k, x: k.x || 0, y: k.y || 0, w: k.w, h: k.h });
  return out;
}

function distribute(total, items, fn) {
  const out = new Map(); let free = total, open = items.slice();
  for (let pass = 0; pass < 4 && open.length; pass++) {
    const each = Math.max(0, free) / open.length; const still = [];
    for (const k of open) {
      const v = fn(k, each);
      if (Math.abs(v - each) > 0.001) { out.set(k, v); free -= v; } else still.push(k);
    }
    if (still.length === open.length) { for (const k of still) out.set(k, each); open = []; break; }
    open = still;
  }
  for (const k of open) out.set(k, Math.max(0, free) / open.length);
  return out;
}

function sizeOf(k, a, other) { // non-fill size of kid k along axis a
  if (k[SZ[a]] === 'F') return k[DIM[a]];
  const d = [null, null]; d[1 - a] = other;
  return size(k, d[0], d[1])[DIM[a]];
}

function spread(pa, free, n, gap) {
  let start = 0, spacing = gap;
  if (free > 0.001 && n) {
    if (pa === 'CENTER') start = free / 2;
    else if (pa === 'MAX') start = free;
    else if (pa === 'SPACE_BETWEEN' && n > 1) spacing = gap + free / (n - 1);
    else if (pa === 'SPACE_AROUND') { spacing = gap + free / n; start = free / n / 2; }
    else if (pa === 'SPACE_EVENLY') { spacing = gap + free / (n + 1); start = free / (n + 1); }
  }
  return { start, spacing };
}

function stack(b, flow, inner, padXY, padStart) {
  const P = b.lm === 'H' ? 0 : 1, C = 1 - P, n = flow.length, gap = b.gap || 0;
  const sp = new Array(n), sc = new Array(n);
  const fills = [];
  flow.forEach((k, i) => {
    if (k[SZ[P]] === 'L') { fills.push(i); sp[i] = 0; return; }
    sp[i] = lim(k, P, sizeOf(k, P, k[SZ[C]] === 'F' ? k[DIM[C]] : null));
  });
  const gaps = gap * Math.max(0, n - 1);
  let innerP = inner[P];
  if (innerP == null) {
    fills.forEach((i) => { sp[i] = lim(flow[i], P, size(flow[i], null, null)[DIM[P]]); });
    innerP = sp.reduce((a, v) => a + v, 0) + gaps;
  } else if (fills.length) {
    const used = sp.reduce((a, v) => a + v, 0) + gaps;
    const dist = distribute(innerP - used, fills.map((i) => flow[i]), (k, each) => lim(k, P, each));
    fills.forEach((i) => { sp[i] = dist.get(flow[i]); });
  }
  let innerC = inner[C];
  const cFill = [];
  flow.forEach((k, i) => {
    if (k[SZ[C]] === 'L') { cFill.push(i); sc[i] = 0; return; }
    if (k[SZ[C]] === 'F') { sc[i] = lim(k, C, k[DIM[C]]); return; }
    const d = [null, null]; d[P] = sp[i];
    sc[i] = lim(k, C, size(k, d[0], d[1])[DIM[C]]);
  });
  if (innerC == null) {
    innerC = sc.reduce((a, v) => Math.max(a, v), 0);
    cFill.forEach((i) => { const d = [null, null]; d[P] = sp[i]; sc[i] = lim(flow[i], C, size(flow[i], d[0], d[1])[DIM[C]]); innerC = Math.max(innerC, sc[i]); });
  }
  cFill.forEach((i) => { sc[i] = lim(flow[i], C, innerC); });
  const total = sp.reduce((a, v) => a + v, 0) + gaps;
  const { start, spacing } = spread(b.pa || 'MIN', innerP - total, n, gap);
  let cur = padStart[P] + start;
  const rects = flow.map((k, i) => {
    const off = b.ca === 'CENTER' ? (innerC - sc[i]) / 2 : b.ca === 'MAX' ? innerC - sc[i] : 0;
    const pos = [0, 0]; pos[P] = cur; pos[C] = padStart[C] + off;
    const dim = [0, 0]; dim[P] = sp[i]; dim[C] = sc[i];
    cur += sp[i] + spacing;
    return { k, x: pos[0], y: pos[1], w: dim[0], h: dim[1] };
  });
  const sz = [0, 0]; sz[P] = innerP + padXY[P]; sz[C] = innerC + padXY[C];
  return { w: sz[0], h: sz[1], rects };
}

function wrap(b, flow, inner, padXY, padStart) {
  const gap = b.gap || 0, gap2 = b.gap2 || 0;
  const kw = flow.map((k) => lim(k, 0, k.sw === 'H' ? size(k, null, k.sh === 'F' ? k.h : null).w : k.w));
  const total = kw.reduce((a, v) => a + v, 0) + gap * Math.max(0, flow.length - 1);
  const iw = inner[0] != null ? inner[0] : total;
  const kh = flow.map((k, i) => lim(k, 1, k.sh === 'H' ? size(k, kw[i], null).h : k.h));
  const rows = []; let row = null, sum = 0;
  flow.forEach((k, i) => {
    if (!row || (row.items.length && sum + gap + kw[i] > iw + 0.01)) { row = { items: [], h: 0 }; rows.push(row); sum = 0; }
    sum += (row.items.length ? gap : 0) + kw[i]; row.items.push(i); row.h = Math.max(row.h, kh[i]); row.sum = sum;
  });
  const rowsH = rows.reduce((a, r) => a + r.h, 0) + gap2 * Math.max(0, rows.length - 1);
  const ih = inner[1] != null ? inner[1] : rowsH;
  let rowGap = gap2;
  if (b.ac === 'SPACE_BETWEEN' && rows.length > 1 && ih > rowsH) rowGap = gap2 + (ih - rowsH) / (rows.length - 1);
  let y = padStart[1]; const rects = [];
  for (const r of rows) {
    const { start, spacing } = spread(b.pa || 'MIN', iw - r.sum, r.items.length, gap);
    let x = padStart[0] + start;
    for (const i of r.items) {
      const off = b.ca === 'CENTER' ? (r.h - kh[i]) / 2 : b.ca === 'MAX' ? r.h - kh[i] : 0;
      rects.push({ k: flow[i], x, y: y + off, w: kw[i], h: kh[i] });
      x += kw[i] + spacing;
    }
    y += r.h + rowGap;
  }
  return { w: iw + padXY[0], h: ih + padXY[1], rects };
}

function grid(b, flow, inner, padXY, padStart) {
  const cols = b.cols || [], rows = b.rows || [], cg = b.cg || 0, rg = b.rg || 0;
  const cellOf = (k) => k.gp || [0, 0, 1, 1];
  const track = (defs, gap, avail, natFn) => {
    const sizes = defs.map((d) => (d.t === 'FIXED' ? d.v : 0));
    defs.forEach((d, i) => { if (d.t === 'HUG' || (d.t === 'FLEX' && avail == null)) sizes[i] = natFn(i); });
    if (avail != null) {
      const flex = defs.map((d, i) => (d.t === 'FLEX' ? i : -1)).filter((i) => i >= 0);
      if (flex.length) {
        const wsum = flex.reduce((a, i) => a + (defs[i].v || 1), 0);
        const used = sizes.reduce((a, v) => a + v, 0) + gap * (defs.length - 1);
        const rest = Math.max(0, avail - used);
        flex.forEach((i) => { sizes[i] = rest * (defs[i].v || 1) / wsum; });
      }
    }
    return sizes;
  };
  const span = (sizes, a, s, gap) => sizes.slice(a, a + s).reduce((x, v) => x + v, 0) + gap * Math.max(0, s - 1);
  const colNat = (i) => flow.reduce((m, k) => { const [, c, , cs] = cellOf(k); return c === i && cs === 1 ? Math.max(m, k.sw === 'F' ? k.w : size(k, null, null).w) : m; }, 0);
  const colW = track(cols, cg, inner[0], colNat);
  const rowNat = (i) => flow.reduce((m, k) => {
    const [r, c, rs, cs] = cellOf(k); if (r !== i || rs !== 1) return m;
    const cw = k.sw === 'L' ? span(colW, c, cs, cg) : (k.sw === 'F' ? k.w : null);
    return Math.max(m, k.sh === 'F' ? k.h : size(k, cw, null).h);
  }, 0);
  const rowH = track(rows, rg, inner[1], rowNat);
  const iw = inner[0] != null ? inner[0] : span(colW, 0, colW.length, cg), ih = inner[1] != null ? inner[1] : span(rowH, 0, rowH.length, rg);
  const colX = []; let cx = padStart[0]; colW.forEach((w) => { colX.push(cx); cx += w + cg; });
  const rowY = []; let cy = padStart[1]; rowH.forEach((h) => { rowY.push(cy); cy += h + rg; });
  const rects = flow.map((k) => {
    const [r, c, rs, cs] = cellOf(k);
    const cw = span(colW, c, cs, cg), ch = span(rowH, r, rs, rg);
    const kw = k.sw === 'L' ? lim(k, 0, cw) : lim(k, 0, k.sw === 'F' ? k.w : size(k, null, null).w);
    const kh = k.sh === 'L' ? lim(k, 1, ch) : lim(k, 1, k.sh === 'F' ? k.h : size(k, kw, null).h);
    const ga = k.ga || ['MIN', 'MIN'];
    return {
      k, w: kw, h: kh,
      x: colX[c] + (ga[0] === 'CENTER' ? (cw - kw) / 2 : ga[0] === 'MAX' ? cw - kw : 0),
      y: rowY[r] + (ga[1] === 'CENTER' ? (ch - kh) / 2 : ga[1] === 'MAX' ? ch - kh : 0),
    };
  });
  return { w: iw + padXY[0], h: ih + padXY[1], rects };
}
