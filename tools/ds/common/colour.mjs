// Colour helpers shared by tokens.mjs / componentize.mjs (spec sections 1.2, 1.4, 4.1, 4.2).
// Colours in node JSON are {r,g,b,a} floats 0..1 (a optional, default 1). Token keys look like 'c:191d24@100'
// (lower-case hex, '@' + alpha*100 rounded to an integer 0..100).

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const byte = (x) => Math.round(clamp01(x) * 255);
const hex2 = (b) => b.toString(16).padStart(2, '0');

/** Accepts {r,g,b,a}, '#rgb' | '#rrggbb' | '#rrggbbaa', or a key 'c:rrggbb@aa'. Returns {r,g,b,a} (0..1). */
export function toRgba(c) {
  if (c == null) throw new TypeError('toRgba: empty colour');
  if (typeof c === 'string') {
    if (c.startsWith('c:')) return parseColourKey(c).rgba;
    let h = c.replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) throw new TypeError(`toRgba: bad colour string ${c}`);
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  return { r: c.r, g: c.g, b: c.b, a: c.a == null ? 1 : c.a };
}

/** '#RRGGBB' (upper case, alpha ignored). */
export function rgbaToHex(c) {
  const { r, g, b } = toRgba(c);
  return '#' + [r, g, b].map((x) => hex2(byte(x))).join('').toUpperCase();
}

/** Lower-case 6-digit hex without '#', used inside keys. */
export const hex6 = (c) => rgbaToHex(c).slice(1).toLowerCase();

export function hexToRgba(hex, a = 1) {
  const c = toRgba(hex);
  const has8 = typeof hex === 'string' && hex.replace('#', '').length === 8;
  return { r: c.r, g: c.g, b: c.b, a: has8 ? c.a : a };
}

/** Alpha as an integer percent 0..100. */
export const alphaPct = (a) => Math.round(clamp01(a == null ? 1 : a) * 100);

/** Token key 'c:rrggbb@aa'. */
export function colourKey(c) {
  const x = toRgba(c);
  return `c:${hex6(x)}@${alphaPct(x.a)}`;
}

export function parseColourKey(key) {
  const m = /^c:([0-9a-f]{6})@(\d{1,3})$/.exec(key);
  if (!m) throw new TypeError(`bad colour key ${key}`);
  const rgba = hexToRgba('#' + m[1], Number(m[2]) / 100);
  return { hex: '#' + m[1].toUpperCase(), a: Number(m[2]) / 100, pct: Number(m[2]), rgba };
}
export const isColourKey = (s) => typeof s === 'string' && /^c:[0-9a-f]{6}@\d{1,3}$/.test(s);

/** Alpha rounded to a 0.02 grid (digest quantisation when no token key is available, spec 1.2). */
export const quantAlpha = (a, step = 0.02) => Math.round((Math.round(clamp01(a == null ? 1 : a) / step + 1e-9) * step) * 1e6) / 1e6;

/** Hash-time paint key when no `tok` exists: 8-bit RGB + alpha on the 0.02 grid, e.g. 'q:2f6fed@50'. */
export function quantKey(c) {
  const x = toRgba(c);
  return `q:${hex6(x)}@${Math.round(quantAlpha(x.a) * 100)}`;
}

// ---- CIELAB (D65) ----
const lin = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
export function rgbToLab(c) {
  const { r, g, b } = toRgba(c);
  const R = lin(byte(r) / 255), G = lin(byte(g) / 255), B = lin(byte(b) / 255);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 distance. This is what spec 1.4/4.2 call dE76 ("CIEDE76"). */
export function deltaE76(c1, c2) {
  const a = rgbToLab(c1), b = rgbToLab(c2);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** CIEDE2000 (Sharma et al.). Never larger than ~dE76 for saturated colours; offered as the stricter perceptual option. */
export function deltaE2000(c1, c2) { return deltaE2000Lab(rgbToLab(c1), rgbToLab(c2)); }

/** CIEDE2000 on CIELAB triples {L,a,b} (exposed for the published reference pairs). */
export function deltaE2000Lab(l1, l2) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(l1.a, l1.b), C2 = Math.hypot(l2.a, l2.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * l1.a, a2 = (1 + G) * l2.a;
  const c1p = Math.hypot(a1, l1.b), c2p = Math.hypot(a2, l2.b);
  const hp = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) * deg + 360) % 360);
  const h1 = hp(l1.b, a1), h2 = hp(l2.b, a2);
  const dL = l2.L - l1.L, dC = c2p - c1p;
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh * rad) / 2);
  const Lm = (l1.L + l2.L) / 2, Cp = (c1p + c2p) / 2;
  let hm;
  if (c1p * c2p === 0) hm = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2;
  else hm = (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cp, Sh = 1 + 0.015 * Cp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

export const DEFAULT_TOL = { deltaE: 1.5, alphaTol: 0.02, metric: '76' };

/**
 * Spec 1.4 colour equality: |dAlpha| <= alphaTol AND deltaE <= deltaE (compared on the RGB part).
 * Identical strings (e.g. equal token keys) short-circuit to true.
 */
export function coloursClose(a, b, opts = {}) {
  const o = { ...DEFAULT_TOL, ...opts };
  if (typeof a === 'string' && a === b) return true;
  const x = toRgba(a), y = toRgba(b);
  if (Math.abs(x.a - y.a) > o.alphaTol + 1e-9) return false;
  const d = o.metric === '2000' ? deltaE2000(x, y) : deltaE76(x, y);
  return d <= o.deltaE + 1e-9;
}

/** Source-over composite of c on a background. */
export function compositeOver(c, bg) {
  const f = toRgba(c), b = toRgba(bg);
  const a = f.a + b.a * (1 - f.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const m = (x, y) => (x * f.a + y * b.a * (1 - f.a)) / a;
  return { r: m(f.r, b.r), g: m(f.g, b.g), b: m(f.b, b.b), a };
}

/** Parse 'rgb(1, 2, 3)' / 'rgba(1,2,3,0.5)' / '#abc' as the walker writes them into svg attributes. */
export function parseCssColour(s) {
  if (!s || s === 'none' || s === 'transparent') return null;
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/i.exec(s.trim());
  if (m) {
    let a = 1;
    if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: Number(m[1]) / 255, g: Number(m[2]) / 255, b: Number(m[3]) / 255, a };
  }
  if (/^#[0-9a-f]{3,8}$/i.test(s.trim())) return toRgba(s.trim());
  return null;
}
