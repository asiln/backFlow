// One node -> list of token "uses" (spec 4.1). Shared by harvest.mjs (counting) and annotate.mjs (writing `tok`), so the
// two can never disagree about which node field produced which key.
//
// A use is { family, key, role, field, i? }
//   family  c (colour) | g (gradient) | t (text style) | r (radius) | sp (spacing) | e (effect) | sz (size)
//   role    colours: fill | text | stroke | icon | shadow | gradient-stop;  others: a descriptive tag (not part of identity)
//   field   the TokRef slot it maps to ('f','s','tx','ic','ts','r','g','g2','p0'..'p3','e','gr') or null when TokRef has none
import { colourKey, toRgba, parseCssColour } from '../common/colour.mjs';
import { textStyleKey, radiusKey, spacingKey, sizeKey, effectKey } from '../common/keys.mjs';
import { roleOf } from '../common/view.mjs';

export const MAX_GAP = 128;
export const BETWEEN = new Set(['SPACE_BETWEEN', 'SPACE_AROUND', 'SPACE_EVENLY']);
export const r2 = (v) => Math.round(v * 100) / 100;
const Z4 = [0, 0, 0, 0];
const visible = (c) => c && (c.a == null ? 1 : c.a) > 0.004;

/** Root colour of an svg string: stroke first, then fill (walker writes resolved rgb()/rgba() strings). */
export function svgRootColour(svg) {
  if (typeof svg !== 'string') return null;
  const head = /<svg\b[^>]*>/i.exec(svg);
  if (!head) return null;
  for (const attr of ['stroke', 'fill']) {
    const m = new RegExp(`\\s${attr}="([^"]+)"`, 'i').exec(head[0]);
    const c = m && parseCssColour(m[1]);
    if (visible(c)) return c;
  }
  return null;
}

/** Gradient list a node renders: `layers` of kind grad when present, else `grads`. Returns [{ i, g }]. */
export function gradientsOf(n) {
  const out = [];
  if (Array.isArray(n.layers)) n.layers.forEach((l, i) => { if (l && l.k === 'grad' && Array.isArray(l.stops)) out.push({ i, g: l }); });
  else if (Array.isArray(n.grads)) n.grads.forEach((g, i) => { if (g && Array.isArray(g.stops)) out.push({ i, g }); });
  return out;
}

/** Canonical gradient key g:<type>:<angle>:<rrggbb@aa~pos,...>. Missing stop positions are spread evenly. */
export function gradientKey(g) {
  const stops = g.stops.filter((s) => s && s.c);
  const n = stops.length;
  const parts = stops.map((s, i) => {
    const pos = s.pos == null ? (n > 1 ? (i / (n - 1)) * 100 : 0) : s.pos * 100;
    const c = toRgba(s.c);
    return `${colourKey(c).slice(2)}~${Math.round(pos * 10) / 10}`;
  });
  return `g:${g.type || 'linear'}:${Math.round((g.angle ?? 180) * 10) / 10}:${parts.join(',')}`;
}

const strokeVisible = (st) => st && st.c && visible(st.c) && !(Array.isArray(st.w) && st.w.every((x) => !(x > 0))) && st.style !== 'none';

/** font -> text style key; line height falls back to ls.tx.lh. */
export function fontKey(font, n, over = {}) {
  const weight = Number(over.weight ?? font.weight);
  const f = {
    family: over.family ?? font.family,
    size: over.size ?? font.size,
    weight: Number.isFinite(weight) ? weight : 400,
    lh: over.lh ?? font.lh ?? (n && n.ls && n.ls.tx && n.ls.tx.lh) ?? 0,
    ls: over.ls ?? font.ls ?? 0,
  };
  if (!f.family || !(f.size > 0)) return null;
  return textStyleKey({ ...f, size: r2(f.size), lh: r2(f.lh), ls: Math.round(f.ls * 1000) / 1000 });
}

/** All uses of one node. Never throws on odd data. */
export function nodeUses(n) {
  const uses = [];
  const u = (family, key, role, field, extra) => { if (key) uses.push({ family, key, role, field, ...extra }); };
  const ls = n.ls || {};
  if (n.t === 'frame' || n.t === 'img') {
    if (visible(n.fill)) u('c', colourKey(n.fill), 'fill', 'f');
    if (strokeVisible(n.stroke)) u('c', colourKey(n.stroke.c), 'stroke', 's');
    const shadows = (n.shadow || []).filter((s) => s && s.c && visible(s.c));
    for (const s of shadows) u('c', colourKey(s.c), 'shadow', null);
    const rad = Array.isArray(n.radius) ? n.radius.map((v) => r2(v || 0)) : n.radius == null ? null : r2(n.radius);
    u('r', radiusKey(rad), 'radius', 'r');
    if (shadows.length) u('e', effectKey(shadows.map((s) => ({ ...s, x: r2(s.x || 0), y: r2(s.y || 0), blur: r2(s.blur || 0), spread: r2(s.spread || 0) }))), 'effect', 'e');
    for (const { i, g } of gradientsOf(n)) {
      u('g', gradientKey(g), 'gradient', 'gr', { i });
      for (const st of g.stops) if (st && visible(st.c)) u('c', colourKey(st.c), 'gradient-stop', null);
    }
    if (n.t === 'frame' && ls.k !== 'N') {
      const g = r2(ls.g || 0), g2 = r2(ls.g2 || 0);
      if (g > 0 && g <= MAX_GAP && !BETWEEN.has(ls.pa)) u('sp', spacingKey(g), 'gap', 'g');
      if (g2 > 0 && g2 <= MAX_GAP) u('sp', spacingKey(g2), 'gap', 'g2');
      const p = ls.p || Z4, bw = ls.bw || Z4;
      for (let i = 0; i < 4; i++) {
        const inner = r2((p[i] || 0) - (bw[i] || 0));
        if (inner > 0 && inner <= MAX_GAP) u('sp', spacingKey(inner), 'padding', `p${i}`);
      }
    }
    if (n.t === 'frame') {
      const role = roleOf(n.name);
      if ((role === 'button' || role === 'input') && n.h > 0) u('sz', sizeKey(r2(n.h)), role, null);
    }
  } else if (n.t === 'text' && n.font) {
    if (visible(n.font.color)) u('c', colourKey(n.font.color), 'text', 'tx');
    const base = fontKey(n.font, n);
    u('t', base, 'text', 'ts');
    if (n.font.shadow && visible(n.font.shadow.c)) u('c', colourKey(n.font.shadow.c), 'shadow', null);
    if (Array.isArray(n.runs)) {
      for (const r of n.runs) {
        if (!r) continue;
        if (visible(r.color)) u('c', colourKey(r.color), 'text', null);
        if (r.family != null || r.size != null || r.weight != null) {
          const size = r.size ?? n.font.size;
          const lhBase = n.font.lh ?? (n.ls && n.ls.tx && n.ls.tx.lh) ?? 0;
          const lh = r.size != null && n.font.size ? Math.round(((lhBase * size) / n.font.size) * 100) / 100 : lhBase;
          const k = fontKey(n.font, n, { family: r.family, size: r.size, weight: r.weight, lh });
          if (k && k !== base) u('t', k, 'text', null);
        }
      }
    }
  } else if (n.t === 'svg') {
    const c = svgRootColour(n.svg);
    if (c) u('c', colourKey(c), 'icon', 'ic');
  }
  return uses;
}

/** Visit every node of a tree (children included, also below `cmp` instances). */
export function walkNodes(n, fn) {
  fn(n);
  if (n.children) for (const c of n.children) walkNodes(c, fn);
}
