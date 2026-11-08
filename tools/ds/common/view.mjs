// The "node view" of spec 1.1: one immutable normalised record per node, so the detector never reads raw JSON.
// Volatile content (text snippets, ids after '#', label after ' · ', image data/asset keys, absolute x/y) never
// enters identity (spec 0.1 / 1.1); `stableName` and `stripVolatile` implement that.
import { toRgba, quantKey, parseCssColour } from './colour.mjs';

export const INTERACTIVE_ROLES = new Set(['button', 'link', 'input', 'item', 'tab', 'alert', 'dialog', 'nav', 'aside', 'header', 'li', 'tr', 'th']);
export const GENERIC_ROLES = new Set(['div', 'span', 'p', 'section', 'form', 'list', 'label', 'bdi']);
export const SYNTHETIC_ROLES = new Set(['gap', 'align']);

/** 'button · Save' -> 'button', 'div#day-8f69' -> 'div', 'Auth / Login' -> 'frame' (spec 1.1 roleOf). */
export const roleOf = (name) => (/^([a-z0-9]+)(?:#| · |$)/i.exec(name || '') || [, 'frame'])[1].toLowerCase();

/** Name without label text and ids: 'item · Notifications' -> 'item', 'input#auth-id' -> 'input'. Free-form names are kept. */
export function stableName(name) {
  if (!name) return '';
  const i = name.indexOf(' · ');
  const h = name.indexOf('#');
  let cut = name.length;
  if (i >= 0) cut = Math.min(cut, i);
  if (h >= 0) cut = Math.min(cut, h);
  return name.slice(0, cut);
}

const r2 = (v) => Math.round(v * 100) / 100;
const four = (a, d = 0) => (Array.isArray(a) && a.length === 4 ? a.map((x) => (x == null ? d : x)) : [d, d, d, d]);

function svgColours(svg) {
  if (typeof svg !== 'string') return [];
  const root = /<svg\b[^>]*>/i.exec(svg);
  const head = root ? root[0] : '';
  const out = [];
  for (const attr of ['stroke', 'fill']) {
    const m = new RegExp(`\\b${attr}="([^"]+)"`, 'i').exec(head);
    const c = m && parseCssColour(m[1]);
    if (c) out.push({ attr, c });
  }
  return out;
}

/**
 * Build a view. opts: { collapse?: boolean (nodes with `cmp` become leaf instances, S='C:<id>' in digests),
 *                       screen?: string, file?: string, screenIdx?: number }
 * path is the array of child indices from the screen root (root = []).
 */
export function makeView(n, opts = {}, path = [], depth = 0) {
  const ls = n.ls || {};
  const tok = n.tok || {};
  const t = n.t;
  const role = roleOf(n.name);
  const v = {
    n, path, depth, screen: opts.screen || '', file: opts.file || '', screenIdx: opts.screenIdx ?? 0,
    t, role, name: stableName(n.name),
    k: ls.k || 'N',
    s: Array.isArray(ls.s) ? ls.s : ['F', 'F'],
    abs: !!ls.abs, sp: !!ls.sp,
    w: n.w, h: n.h,
    g: ls.g || 0, g2: ls.g2 || 0,
    p: four(ls.p), bw: four(ls.bw),
    opacity: n.opacity == null ? 1 : n.opacity,
    clip: !!n.clip,
    pos: n.pos || '',
    radius: Array.isArray(n.radiusArr) ? four(n.radiusArr) : Array.isArray(n.radius) ? four(n.radius) : four([n.radius || 0, n.radius || 0, n.radius || 0, n.radius || 0]),
    strokeW: n.stroke ? four(n.stroke.w, 0) : [0, 0, 0, 0],
    shadows: (n.shadow || []).map((s) => ({ x: s.x || 0, y: s.y || 0, blur: s.blur || 0, spread: s.spread || 0, inset: !!s.inset, c: s.c })),
    cmp: n.cmp || null,
    tok,
    inst: null,
    paints: [],
    text: null, svg: null, img: null,
    kids: [],
  };
  v.pInner = v.p.map((x, i) => r2(x - v.bw[i])); // padding after the drawn stroke is subtracted (spec 4.1)
  v.styled = !!(n.fill || n.stroke || n.radius || (n.shadow || []).length || n.layers || n.grads);
  v.hasGrad = !!(n.grads || (n.layers && n.layers.some((l) => l.k === 'grad')));

  const P = (role2, c, key) => { if (c) v.paints.push({ role: role2, c: toRgba(c), key: key || quantKey(c) }); };
  if (t === 'frame' || t === 'img') {
    P('fill', n.fill, tok.f);
    if (n.stroke) P('stroke', n.stroke.c, tok.s);
  }
  for (const s of v.shadows) P('shadow', s.c);
  if (t === 'text') {
    const f = n.font || {};
    const tx = ls.tx || {};
    v.text = {
      family: f.family || '', size: f.size || 0, weight: f.weight || 400, lh: f.lh || 0, ls: f.ls || 0,
      lines: tx.l || 1, multi: (tx.l || 1) > 1, trunc: !!(tx.tr), hasRuns: !!(n.runs && n.runs.length),
      align: f.align || '', color: f.color ? toRgba(f.color) : null,
    };
    P('text', f.color, tok.tx);
    if (f.shadow && f.shadow.c) P('shadow', f.shadow.c);
  } else if (t === 'svg') {
    const cols = svgColours(n.svg);
    v.svg = { w: n.w, h: n.h, colours: cols };
    cols.forEach((x, i) => P('icon', x.c, i === 0 ? tok.ic : null));
  } else if (t === 'img') {
    v.img = { fit: n.fit || '' };
  }

  if (opts.collapse && n.cmp) {
    v.inst = { id: n.cmp.id, v: n.cmp.v || null };
    v.kids = [];
  } else if (n.children && n.children.length) {
    v.kids = n.children.map((c, i) => makeView(c, opts, path.concat(i), depth + 1));
  }
  return v;
}

/** Views for all frames of an export file ({frames:[...]}). */
export function screenViews(file, opts = {}) {
  return (file.frames || []).map((f, i) => makeView(f, { ...opts, screen: f.name, screenIdx: i }));
}

/** Depth-first, parents first. fn(view) may return false to skip the subtree. */
export function walkView(v, fn) {
  if (fn(v) === false) return;
  for (const k of v.kids) walkView(k, fn);
}

export function countNodes(v) {
  let c = 0;
  walkView(v, () => { c++; });
  return c;
}

/** Follow an index path ([] = the root) through raw nodes. */
export function nodeAt(root, path) {
  let n = root;
  for (const i of path) {
    if (!n || !n.children || !n.children[i]) return null;
    n = n.children[i];
  }
  return n;
}

export const formatPath = (path) => path.join('/');
export const parsePath = (s) => (s === '' || s == null ? [] : String(s).split('/').map(Number));

/** Locator used in reports: '<file>/<screen name>#<screenIdx>/<path>' (spec 1.9 `examples`). */
export const locator = (v) => `${v.file}/${v.screen}#${v.screenIdx}${v.path.length ? '/' + formatPath(v.path) : ''}`;

/**
 * Copy of a raw node tree without volatile content: names reduced to stableName, text/data/asset removed, x/y removed.
 * Two nodes that differ only in label text or ids strip to deep-equal values.
 */
export function stripVolatile(n) {
  const o = { ...n };
  o.name = stableName(n.name);
  delete o.x; delete o.y; delete o.text; delete o.data; delete o.asset; delete o.alt; delete o.runs;
  if (o.svg) o.svg = o.svg.replace(/\sd="[^"]*"/g, ' d=""');
  if (n.children) o.children = n.children.map(stripVolatile);
  return o;
}

/** Number of leaves (text/svg/img/collapsed instances) in a view. */
export function leafCount(v) {
  if (v.t !== 'frame' || v.inst || !v.kids.length) return v.t === 'frame' && !v.inst ? 0 : 1;
  return v.kids.reduce((a, k) => a + leafCount(k), 0);
}
