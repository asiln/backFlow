// Canonical icon geometry signature (spec 3.1).
//   iconSig(svgString) -> { geom, shape, vb, kind, strokeWidth?, size, color, struct, nums, info, elements }
// Identity ignores colour, render size, ids, attribute order, element grouping/order (for same-style elements), path syntax
// (relative/absolute, H/V/S/T, implicit commands, number formatting), viewBox scale (everything is mapped into a 24 box) and
// the root width/height. `geom` includes the style that matters for rendering (kind, stroke width, caps, joins, opacity, dash,
// fill rule); `shape` is geometry only (use it to look names up). `struct` + `nums` feed tolerance clustering (cluster.mjs).
import { hashStr } from '../common/hash.mjs';
import { parseCssColour, colourKey } from '../common/colour.mjs';

export const CANON = 24;
const r2 = (n) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; };
const fmt = (n) => String(r2(n));
const fmt3 = (n) => { const v = Math.round(n * 1000) / 1000; return String(v === 0 ? 0 : v); };

// ------------------------------------------------------------------ tiny XML parser
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
  return ENT[e.toLowerCase()] ?? m;
}));
const localName = (s) => { const k = s.indexOf(':'); return k < 0 ? s : s.slice(k + 1); };

/** Parses the XML subset SVG strings use. Returns the root element {tag, attrs, children, text} or null. */
export function parseXml(src) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    const top = stack[stack.length - 1];
    if (lt > i) { const t = src.slice(i, lt); if (t.trim()) top.text += decode(t); }
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); top.text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    if (src[lt + 1] === '/') { const e = src.indexOf('>', lt); if (stack.length > 1) stack.pop(); i = e < 0 ? n : e + 1; continue; }
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(src[j])) j++;
    const el = { tag: localName(src.slice(lt + 1, j)), attrs: {}, children: [], text: '' };
    let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (j >= n) break;
      if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break; }
      if (src[j] === '>') { j++; break; }
      let k = j;
      while (k < n && !/[\s=/>]/.test(src[k])) k++;
      if (k === j) { j++; continue; }
      const name = src.slice(j, k);
      j = k;
      while (j < n && /\s/.test(src[j])) j++;
      let val = '';
      if (src[j] === '=') {
        j++;
        while (j < n && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") { const e = src.indexOf(q, j + 1); val = src.slice(j + 1, e < 0 ? n : e); j = e < 0 ? n : e + 1; }
        else { k = j; while (k < n && !/[\s>]/.test(src[k])) k++; val = src.slice(j, k); j = k; }
      }
      el.attrs[name.startsWith('xlink:') ? name.slice(6) : name] = decode(val);
    }
    if (el.attrs.style) {
      for (const decl of el.attrs.style.split(';')) {
        const c = decl.indexOf(':');
        if (c > 0) el.attrs[decl.slice(0, c).trim()] = decl.slice(c + 1).trim();
      }
    }
    top.children.push(el);
    if (!selfClose) stack.push(el);
    i = j;
  }
  return root.children[0] || null;
}

// ------------------------------------------------------------------ numbers, matrices
const num = (v, d = 0) => { if (v == null || v === '') return d; const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
const px = (v) => (v == null || /%$/.test(String(v).trim()) ? 0 : num(v, 0));

const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const pt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const det = (m) => m[0] * m[3] - m[1] * m[2];

export function parseTransform(s) {
  let m = I;
  if (!s) return m;
  for (const t of s.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = (t[2].match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
    let k = I;
    switch (t[1]) {
      case 'matrix': if (a.length >= 6) k = a.slice(0, 6); break;
      case 'translate': k = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': k = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
        k = [c, sn, -sn, c, 0, 0];
        if (a.length >= 3) k = mul(mul([1, 0, 0, 1, a[1], a[2]], k), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': k = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': k = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: break;
    }
    m = mul(m, k);
  }
  return m;
}

// ------------------------------------------------------------------ path data
const ARGC = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Path data -> absolute segments [{c:'M'|'L'|'C'|'Q'|'A'|'Z', a:[...]}] (H/V -> L, S -> C, T -> Q, relative -> absolute). Never throws. */
export function parsePath(d) {
  const out = [];
  if (!d) return out;
  const s = String(d);
  let i = 0;
  const n = s.length;
  const ws = () => { while (i < n && /[\s,]/.test(s[i])) i++; };
  const readNum = () => {
    ws();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.slice(i, i + 40));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const readFlag = () => { ws(); if (s[i] === '0' || s[i] === '1') return Number(s[i++]); return null; };
  let cx = 0, cy = 0, sx = 0, sy = 0, lastC = null, lastQ = null, cmd = null;
  while (i < n) {
    ws();
    if (i >= n) break;
    if (/[a-zA-Z]/.test(s[i])) { cmd = s[i++]; if (!(cmd.toUpperCase() in ARGC)) break; }
    else if (cmd == null) break;
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    else if (cmd === 'Z' || cmd === 'z') break; // numbers after Z are garbage
    const up = cmd.toUpperCase(), rel = cmd !== up;
    if (up === 'Z') { out.push({ c: 'Z', a: [] }); cx = sx; cy = sy; lastC = lastQ = null; if (i < n && !/[a-zA-Z\s,]/.test(s[i])) break; continue; }
    const a = [];
    let ok = true;
    for (let k = 0; k < ARGC[up]; k++) {
      const v = up === 'A' && (k === 3 || k === 4) ? readFlag() : readNum();
      if (v == null) { ok = false; break; }
      a.push(v);
    }
    if (!ok) break;
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    switch (up) {
      case 'M': cx = a[0] + ox; cy = a[1] + oy; sx = cx; sy = cy; out.push({ c: 'M', a: [cx, cy] }); lastC = lastQ = null; break;
      case 'L': cx = a[0] + ox; cy = a[1] + oy; out.push({ c: 'L', a: [cx, cy] }); lastC = lastQ = null; break;
      case 'H': cx = a[0] + ox; out.push({ c: 'L', a: [cx, cy] }); lastC = lastQ = null; break;
      case 'V': cy = a[0] + oy; out.push({ c: 'L', a: [cx, cy] }); lastC = lastQ = null; break;
      case 'C': { const seg = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy]; out.push({ c: 'C', a: seg }); lastC = [seg[2], seg[3]]; lastQ = null; cx = seg[4]; cy = seg[5]; break; }
      case 'S': { const r = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy]; const seg = [r[0], r[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]; out.push({ c: 'C', a: seg }); lastC = [seg[2], seg[3]]; lastQ = null; cx = seg[4]; cy = seg[5]; break; }
      case 'Q': { const seg = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]; out.push({ c: 'Q', a: seg }); lastQ = [seg[0], seg[1]]; lastC = null; cx = seg[2]; cy = seg[3]; break; }
      case 'T': { const r = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy]; const seg = [r[0], r[1], a[0] + ox, a[1] + oy]; out.push({ c: 'Q', a: seg }); lastQ = [seg[0], seg[1]]; lastC = null; cx = seg[2]; cy = seg[3]; break; }
      case 'A': cx = a[5] + ox; cy = a[6] + oy; out.push({ c: 'A', a: [a[0], a[1], a[2], a[3], a[4], cx, cy] }); lastC = lastQ = null; break;
      default: break;
    }
  }
  // a segment after Z without M starts at the subpath start: make that explicit
  const fixed = [];
  let closed = false, st = null;
  for (const sg of out) {
    if (sg.c === 'M') { st = sg.a; closed = false; fixed.push(sg); continue; }
    if (closed && sg.c !== 'Z') { fixed.push({ c: 'M', a: st.slice() }); closed = false; }
    if (sg.c === 'Z') closed = true;
    fixed.push(sg);
  }
  return fixed;
}

// SVG implementation notes F.6.5: arc -> cubic beziers
function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if ((x1 === x2 && y1 === y2) || rx === 0 || ry === 0) return [{ c: 'L', a: [x2, y2] }];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const num_ = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num_ / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
  const nseg = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / nseg, t = (4 / 3) * Math.tan(step / 4);
  const res = [];
  let a1 = th1;
  for (let k = 0; k < nseg; k++) {
    const a2 = a1 + step;
    const p = (a, dxx, dyy) => {
      const ex = Math.cos(a) + dxx, ey = Math.sin(a) + dyy;
      return [cp * rx * ex - sp * ry * ey + cx, sp * rx * ex + cp * ry * ey + cy];
    };
    const c1 = p(a1, -t * Math.sin(a1), t * Math.cos(a1)), c2 = p(a2, t * Math.sin(a2), -t * Math.cos(a2)), e = p(a2, 0, 0);
    res.push({ c: 'C', a: [c1[0], c1[1], c2[0], c2[1], k === nseg - 1 ? x2 : e[0], k === nseg - 1 ? y2 : e[1]] });
    a1 = a2;
  }
  return res;
}

const simpleMatrix = (m) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(Math.abs(m[0]) - Math.abs(m[3])) < 1e-9 * Math.max(1, Math.abs(m[0]));

/** Applies an affine matrix to absolute segments (arcs stay arcs under translate/uniform scale/flip, else become cubics). */
export function transformSegs(segs, m) {
  if (m === I) return segs;
  const out = [];
  let cx = 0, cy = 0;
  const simple = simpleMatrix(m);
  for (const sg of segs) {
    const a = sg.a;
    switch (sg.c) {
      case 'M': case 'L': { const p = pt(m, a[0], a[1]); out.push({ c: sg.c, a: p }); cx = a[0]; cy = a[1]; break; }
      case 'C': { const p1 = pt(m, a[0], a[1]), p2 = pt(m, a[2], a[3]), p3 = pt(m, a[4], a[5]); out.push({ c: 'C', a: [...p1, ...p2, ...p3] }); cx = a[4]; cy = a[5]; break; }
      case 'Q': { const p1 = pt(m, a[0], a[1]), p2 = pt(m, a[2], a[3]); out.push({ c: 'Q', a: [...p1, ...p2] }); cx = a[2]; cy = a[3]; break; }
      case 'A': {
        if (simple && Math.abs(a[2]) % 180 === 0) {
          const k = Math.abs(m[0]), p = pt(m, a[5], a[6]);
          out.push({ c: 'A', a: [a[0] * k, a[1] * k, a[2], a[3], det(m) < 0 ? 1 - a[4] : a[4], p[0], p[1]] });
        } else {
          for (const cs of arcToCubics(cx, cy, a[0], a[1], a[2], a[3], a[4], a[5], a[6])) {
            if (cs.c === 'L') { out.push({ c: 'L', a: pt(m, cs.a[0], cs.a[1]) }); continue; }
            out.push({ c: 'C', a: [...pt(m, cs.a[0], cs.a[1]), ...pt(m, cs.a[2], cs.a[3]), ...pt(m, cs.a[4], cs.a[5])] });
          }
        }
        cx = a[5]; cy = a[6];
        break;
      }
      default: out.push({ c: 'Z', a: [] }); break;
    }
  }
  return out;
}

/** Splits absolute segments into subpaths (each starts with M). */
function subpaths(segs) {
  const subs = [];
  let cur = null;
  for (const sg of segs) {
    if (sg.c === 'M') { cur = [sg]; subs.push(cur); } else if (cur) cur.push(sg);
  }
  return subs;
}

/** Canonical text + numbers of one subpath (2 decimals). Drops a closing L that returns to the start before Z; drops a lone M. */
function canonSub(sub) {
  let segs = sub;
  if (segs.length >= 3 && segs[segs.length - 1].c === 'Z') {
    const last = segs[segs.length - 2], st = segs[0].a;
    if (last.c === 'L' && r2(last.a[0]) === r2(st[0]) && r2(last.a[1]) === r2(st[1])) segs = [...segs.slice(0, -2), segs[segs.length - 1]];
  }
  if (segs.length < 2) return null; // a bare moveto draws nothing
  const cmd = segs.map((s) => s.c).join('');
  const nums = [];
  for (const sg of segs) for (const v of sg.a) nums.push(r2(v));
  return { cmd, nums, text: segs.map((s) => s.c + s.a.map(fmt).join(' ')).join('') };
}

const dString = (segs) => segs.map((s) => s.c + s.a.map(fmt3).join(' ')).join('');

// ------------------------------------------------------------------ shapes -> path segments
const P = (c, ...a) => ({ c, a });
function shapeSegs(el) {
  const a = el.attrs;
  switch (el.tag) {
    case 'path': return parsePath(a.d);
    case 'line': return [P('M', num(a.x1), num(a.y1)), P('L', num(a.x2), num(a.y2))];
    case 'polyline': case 'polygon': {
      const v = (a.points || '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
      const segs = [];
      for (let i = 0; i + 1 < v.length; i += 2) segs.push(P(i === 0 ? 'M' : 'L', Number(v[i]), Number(v[i + 1])));
      if (el.tag === 'polygon' && segs.length) segs.push(P('Z'));
      return segs;
    }
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (w <= 0 || h <= 0) return [];
      let rx = a.rx != null ? num(a.rx) : null, ry = a.ry != null ? num(a.ry) : null;
      if (rx == null && ry == null) { rx = ry = 0; } else { if (rx == null) rx = ry; if (ry == null) ry = rx; }
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return [P('M', x, y), P('L', x + w, y), P('L', x + w, y + h), P('L', x, y + h), P('Z')];
      return [P('M', x + rx, y), P('L', x + w - rx, y), P('A', rx, ry, 0, 0, 1, x + w, y + ry), P('L', x + w, y + h - ry), P('A', rx, ry, 0, 0, 1, x + w - rx, y + h),
        P('L', x + rx, y + h), P('A', rx, ry, 0, 0, 1, x, y + h - ry), P('L', x, y + ry), P('A', rx, ry, 0, 0, 1, x + rx, y), P('Z')];
    }
    case 'circle': case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy);
      const rx = el.tag === 'circle' ? num(a.r) : num(a.rx), ry = el.tag === 'circle' ? num(a.r) : num(a.ry);
      if (rx <= 0 || ry <= 0) return [];
      return [P('M', cx - rx, cy), P('A', rx, ry, 0, 1, 0, cx + rx, cy), P('A', rx, ry, 0, 1, 0, cx - rx, cy), P('Z')];
    }
    default: return [];
  }
}
const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const CONTAINERS = new Set(['g', 'a', 'switch', 'svg']);
const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'color'];

// ------------------------------------------------------------------ signature
function paintClass(v) {
  if (v == null || v === 'none' || v === 'transparent') return 'n';
  if (/^url\(/i.test(v)) return 'g';
  return 'p';
}

/**
 * @param {string} svg
 * @returns {{geom:string, shape:string, vb:number[], kind:'stroke'|'fill', strokeWidth?:number, size:[number,number],
 *   color:{r:number,g:number,b:number,a:number}|null, colorKey:string|null, struct:string, nums:number[], info:object, elements:object[]}}
 */
export function iconSig(svg) {
  const root = typeof svg === 'string' ? parseXml(svg) : svg;
  const info = { elements: 0, subpaths: 0, segments: 0, text: false, image: false, gradient: false, filter: false, clip: false, use: false, nonScaling: false, dashed: false, mixed: false, ariaLabel: null, parseError: false };
  if (!root || root.tag !== 'svg') {
    info.parseError = true;
    return { geom: hashStr('invalid'), shape: hashStr('invalid'), vb: [0, 0, CANON, CANON], kind: 'fill', size: [0, 0], color: null, colorKey: null, struct: 'invalid', nums: [], info, elements: [] };
  }
  const ra = root.attrs;
  info.ariaLabel = ra['aria-label'] || null;
  let w = px(ra.width), h = px(ra.height);
  let vb = null;
  if (ra.viewBox) {
    const v = ra.viewBox.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
    if (v && v.length === 4 && Number(v[2]) > 0 && Number(v[3]) > 0) vb = v.map(Number);
  }
  if (!vb) vb = [0, 0, w || h || CANON, h || w || CANON];
  if (!w) w = vb[2]; if (!h) h = vb[3];
  const sc = CANON / Math.max(vb[2], vb[3]);
  const norm = [sc, 0, 0, sc, -vb[0] * sc, -vb[1] * sc];

  const elements = [];
  const walk = (el, inh, m, op) => {
    const st = { ...inh };
    for (const k of INHERITED) { const v = el.attrs[k]; if (v != null && v !== 'inherit') st[k] = v; }
    let mm = el.tag === 'svg' && el !== root ? m : mul(m, parseTransform(el.attrs.transform));
    let o = op;
    if (el.attrs.opacity != null) o *= Math.min(1, Math.max(0, num(el.attrs.opacity, 1)));
    if (el.attrs.display === 'none' || el.attrs.visibility === 'hidden' || o === 0) return;
    if (el.attrs['clip-path'] && /url\(/.test(el.attrs['clip-path'])) info.clip = true;
    if (el.attrs.mask && /url\(/.test(el.attrs.mask)) info.clip = true;
    if (el.attrs.filter && el.attrs.filter !== 'none') info.filter = true;
    if (el.tag === 'svg' && el !== root) {
      const a = el.attrs, nw = px(a.width), nh = px(a.height);
      let nm = mul(m, [1, 0, 0, 1, px(a.x), px(a.y)]);
      const v = a.viewBox && a.viewBox.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
      if (v && v.length === 4 && nw > 0 && nh > 0 && Number(v[2]) > 0 && Number(v[3]) > 0) {
        const k = Math.min(nw / Number(v[2]), nh / Number(v[3]));
        nm = mul(nm, [k, 0, 0, k, -Number(v[0]) * k, -Number(v[1]) * k]);
      }
      mm = nm;
    }
    if (CONTAINERS.has(el.tag)) { for (const c of el.children) walk(c, st, mm, o); return; }
    if (el.tag === 'text' || el.tag === 'tspan') { info.text = true; return; }
    if (el.tag === 'image') { info.image = true; return; }
    if (el.tag === 'use') { info.use = true; return; }
    if (!SHAPES.has(el.tag)) return; // defs, filter, clipPath, gradients, title ... are not drawn
    info.elements++;
    const fillV = st.fill ?? 'black', strokeV = st.stroke ?? 'none';
    const fc = paintClass(fillV);
    let sc_ = paintClass(strokeV);
    const sw0 = num(st['stroke-width'], 1);
    if (sw0 <= 0) sc_ = 'n';
    if (fc === 'g' || sc_ === 'g') info.gradient = true;
    if (el.attrs['vector-effect'] === 'non-scaling-stroke') info.nonScaling = true;
    const segsVb = transformSegs(shapeSegs(el), mm);
    const scale = Math.sqrt(Math.abs(det(mm)));
    const segs = transformSegs(segsVb, norm);
    const subs = subpaths(segs).map(canonSub).filter(Boolean);
    if (!subs.length) return;
    const dash = st['stroke-dasharray'] && st['stroke-dasharray'] !== 'none' ? st['stroke-dasharray'] : null;
    if (dash && sc_ !== 'n') info.dashed = true;
    const fop = fc === 'n' ? 1 : num(st['fill-opacity'], 1), sop = sc_ === 'n' ? 1 : num(st['stroke-opacity'], 1);
    const style = {
      fill: fc, stroke: sc_,
      sw: sc_ === 'n' ? 0 : Math.round(sw0 * scale * sc * 10) / 10,
      swVb: sc_ === 'n' ? 0 : sw0 * scale,
      cap: sc_ === 'n' ? '' : st['stroke-linecap'] || 'butt',
      join: sc_ === 'n' ? '' : st['stroke-linejoin'] || 'miter',
      dash: dash && sc_ !== 'n' ? (dash.match(/[\d.]+/g) || []).map((v) => r2(Number(v) * scale * sc)).join(' ') : '',
      rule: fc === 'n' ? '' : st['fill-rule'] || 'nonzero',
      op: Math.round(o * Math.max(fop, 0) * 20) / 20,
      sop: Math.round(sop * 20) / 20,
      color: st.color,
      fillV, strokeV,
    };
    elements.push({ style, subs, dVb: dString(segsVb), w: sw0 * scale });
    info.subpaths += subs.length;
    for (const s of subs) info.segments += s.cmd.length;
  };
  walk(root, {}, I, 1);

  // ---- groups by style (colour excluded), canonical order
  const styleKey = (s) => [`f${s.fill}`, `s${s.stroke}`, s.stroke !== 'n' ? `w${s.sw}c${s.cap}j${s.join}d${s.dash}` : '', s.fill !== 'n' && s.rule !== 'nonzero' ? `r${s.rule}` : '', s.op !== 1 ? `o${s.op}` : '', s.sop !== 1 && s.stroke !== 'n' ? `so${s.sop}` : ''].join('|');
  const groups = new Map();
  for (const e of elements) {
    const k = styleKey(e.style);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    for (const s of e.subs) g.push(s);
  }
  const sortSubs = (a, b) => (a.cmd < b.cmd ? -1 : a.cmd > b.cmd ? 1 : coarse(a) < coarse(b) ? -1 : coarse(a) > coarse(b) ? 1 : 0);
  const coarse = (s) => s.coarse ?? (s.coarse = s.nums.map((v) => Math.round(v)).join(','));
  const keys = [...groups.keys()].sort();
  const gl = keys.map((k) => ({ k, subs: groups.get(k).sort(sortSubs) }));
  const all = [].concat(...elements.map((e) => e.subs)).sort(sortSubs);

  const hasFill = elements.some((e) => e.style.fill !== 'n');
  const hasStroke = elements.some((e) => e.style.stroke !== 'n');
  const kind = !hasFill && hasStroke ? 'stroke' : 'fill';
  info.mixed = hasFill && hasStroke;

  const struct = JSON.stringify(gl.map((g) => [g.k, g.subs.map((s) => s.cmd)]));
  const nums = [].concat(...gl.map((g) => [].concat(...g.subs.map((s) => s.nums))));
  const geom = hashStr(JSON.stringify(gl.map((g) => [g.k, g.subs.map((s) => s.text)])));
  const shape = hashStr(JSON.stringify(all.map((s) => s.text)));

  const first = elements.find((e) => (kind === 'stroke' ? e.style.stroke !== 'n' : e.style.fill !== 'n')) || elements[0];
  let color = null;
  if (first) {
    const raw = kind === 'stroke' ? first.style.strokeV : first.style.fillV;
    const v = /^currentcolor$/i.test(raw || '') ? first.style.color : raw;
    color = parseCssColour(v || '') || (first.style.fill === 'p' && kind === 'fill' && /^(black)$/i.test(raw) ? { r: 0, g: 0, b: 0, a: 1 } : null);
    if (color) {
      const al = (kind === 'stroke' ? first.style.sop : 1) * first.style.op;
      if (al !== 1) color = { ...color, a: Math.round(color.a * al * 100) / 100 };
    }
  }
  const out = { geom, shape, vb, kind, size: [w, h], color, colorKey: color ? colourKey(color) : null, struct, nums, info, elements };
  if (kind === 'stroke' || hasStroke) out.strokeWidth = r2(first && first.style.stroke !== 'n' ? first.style.swVb : (elements.find((e) => e.style.stroke !== 'n') || { style: { swVb: 0 } }).style.swVb);
  return out;
}

/** Clean standalone svg for a library icon: coordinates in the original viewBox, colours -> currentColor, one flat <path> per element. */
export function canonicalSvg(sig) {
  const [x, y, w, h] = sig.vb;
  const stroke = sig.kind === 'stroke';
  const rootStyle = stroke
    ? { fill: 'n', stroke: 'p', swVb: sig.strokeWidth || 1, cap: sig.elements[0]?.style.cap || 'round', join: sig.elements[0]?.style.join || 'round' }
    : { fill: 'p', stroke: 'n', swVb: 0, cap: 'butt', join: 'miter' };
  let a = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt3(w)}" height="${fmt3(h)}" viewBox="${[x, y, w, h].map(fmt3).join(' ')}" fill="${rootStyle.fill === 'p' ? 'currentColor' : 'none'}"`;
  if (stroke) a += ` stroke="currentColor" stroke-width="${fmt3(rootStyle.swVb)}" stroke-linecap="${rootStyle.cap}" stroke-linejoin="${rootStyle.join}"`;
  a += '>';
  for (const e of sig.elements) {
    const s = e.style;
    let at = '';
    if (s.fill !== rootStyle.fill) at += ` fill="${s.fill === 'p' ? 'currentColor' : 'none'}"`;
    if (s.stroke !== rootStyle.stroke) at += ` stroke="${s.stroke === 'p' ? 'currentColor' : 'none'}"`;
    if (s.stroke === 'p') {
      if (!stroke || Math.abs(s.swVb - rootStyle.swVb) > 1e-6) at += ` stroke-width="${fmt3(s.swVb)}"`;
      if (!stroke || s.cap !== rootStyle.cap) at += ` stroke-linecap="${s.cap}"`;
      if (!stroke || s.join !== rootStyle.join) at += ` stroke-linejoin="${s.join}"`;
      if (s.dash) at += ` stroke-dasharray="${s.dash}"`;
    }
    if (s.fill === 'p' && s.rule !== 'nonzero') at += ` fill-rule="${s.rule}"`;
    if (s.op !== 1) at += ` opacity="${s.op}"`;
    a += `<path d="${e.dVb}"${at}/>`;
  }
  return a + '</svg>';
}
