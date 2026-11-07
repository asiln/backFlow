// Tailwind config reader for tokens.mjs (spec 4.3). Zero dependencies.
//
// The config is a JavaScript file (CommonJS, ESM or light TypeScript), so it is evaluated in a `node:vm` context with
// a forgiving `require`: relative requires of .js/.cjs/.json files are followed, every other module (plugins,
// `tailwindcss/colors`, `tailwindcss/plugin`, ...) becomes an inert stub that tolerates calls, property access and
// spreading. `export default` and `import` statements are rewritten to the same mechanism. Theme values that are
// functions (`colors: ({ theme }) => ...`) are called with a `theme()` lookup into the resolved theme.
// This is NOT a security boundary: only point it at config files you trust (your own project's config).
//
// Result model (`loadTailwind`, `tailwindFromConfig`):
//   { colors:   [{ name, rgba, raw }]     flattened, config order ('accent.DEFAULT' -> 'accent', 'accent.dk' -> 'accent-dk')
//     radius:   { [name]: px }            'DEFAULT' is kept as a key (class 'rounded'); full/pill (>= 999px) are dropped
//     spacing:  { [name]: px }
//     fontSize: [{ name, size, lh|null, weight|null }]   ONLY entries the project config defines (no built-in defaults)
//     shadows:  [{ name, key }]           effect keys of theme.boxShadow (+ built-in defaults)
//     fontFamily: { [name]: string[] }
//     unresolved: [{ name, value }]       colours that reference CSS variables / unsupported syntax
//     defaults: boolean }
// Built-in defaults (Tailwind v3 spacing, borderRadius, boxShadow, white/black) are merged unless `defaults:false`
// or the config REPLACES the key (`theme.spacing`, not `theme.extend.spacing`).
//
// CSS-variable extension hook (projects such as shadcn/ui define colours as `hsl(var(--primary))`):
//   loadTailwind(file, { cssVars: { '--primary': '222 47% 11%' } })       // plain map
//   loadTailwind(file, { resolveVar: (name) => '#112233' | undefined })   // function
//   parseCssVariables(cssText) -> { '--x': 'value' }                      // reads `--x: value;` declarations
// Colours whose variables stay unresolved are listed in `unresolved` and are not used for naming.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseCssColour, toRgba } from '../common/colour.mjs';
import { effectKey } from '../common/keys.mjs';

export const DEFAULT_SPACING = Object.fromEntries([
  ['0', 0], ['px', 1], ['0.5', 2], ['1', 4], ['1.5', 6], ['2', 8], ['2.5', 10], ['3', 12], ['3.5', 14], ['4', 16], ['5', 20], ['6', 24], ['7', 28],
  ['8', 32], ['9', 36], ['10', 40], ['11', 44], ['12', 48], ['14', 56], ['16', 64], ['20', 80], ['24', 96], ['28', 112], ['32', 128], ['36', 144],
  ['40', 160], ['44', 176], ['48', 192], ['52', 208], ['56', 224], ['60', 240], ['64', 256], ['72', 288], ['80', 320], ['96', 384],
]);
export const DEFAULT_RADIUS = { none: 0, sm: 2, DEFAULT: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 9999 };
export const DEFAULT_SHADOWS = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
};
export const DEFAULT_COLORS = { white: '#ffffff', black: '#000000' };

// ---- inert stub for modules the config requires but we do not need ----
function makeStub() {
  const target = function () {};
  const stub = new Proxy(target, {
    get(_t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === Symbol.iterator) return function* () {};
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON') return undefined;
      if (p === '__esModule') return false;
      return stub;
    },
    apply: () => stub,
    construct: () => stub,
    has: () => false,
    ownKeys: () => ['prototype'],
    getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
  });
  return stub;
}

// ---- source transforms (ESM / light TS -> CommonJS) ----
function transformSource(src) {
  let s = src.replace(/^﻿/, '');
  s = s.replace(/^\s*import\s+type\s+[^;\n]*?from\s+['"][^'"]+['"];?/gm, '');
  s = s.replace(/^\s*import\s+([^'"\n;]+?)\s+from\s+(['"][^'"]+['"]);?/gm, (_m, clause, spec) => {
    const c = clause.trim();
    const out = [];
    const named = /\{([^}]*)\}/.exec(c);
    const head = c.replace(/\{[^}]*\}/, '').replace(/,\s*$/, '').trim();
    if (head && !head.startsWith('*')) out.push(`const ${head} = __interop(__req(${spec}));`);
    else if (head.startsWith('*')) out.push(`const ${head.replace(/^\*\s*as\s+/, '')} = __req(${spec});`);
    if (named) {
      const names = named[1].split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\s+as\s+/, ': '));
      out.push(`const { ${names.join(', ')} } = __req(${spec});`);
    }
    return out.join(' ');
  });
  s = s.replace(/^\s*import\s+['"][^'"]+['"];?/gm, '');
  s = s.replace(/\bexport\s+default\s+/, 'module.exports = ');
  s = s.replace(/\bexport\s+(const|let|var|function)\s/g, '$1 ');
  s = s.replace(/\s+satisfies\s+[A-Za-z_.]+(?:<[^>]*>)?/g, '');
  s = s.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[A-Za-z_.]+(?:<[^>]*>)?\s*=/g, '$1 $2 =');
  s = s.replace(/\s+as\s+(?:const|[A-Z][A-Za-z_.]*)(?=\s*[,;)\]}\n])/g, '');
  return s;
}

function runConfigFile(file, seen = new Set()) {
  const abs = path.resolve(file);
  if (seen.has(abs)) return {};
  seen.add(abs);
  const text = fs.readFileSync(abs, 'utf8');
  if (path.extname(abs).toLowerCase() === '.json') return JSON.parse(text);
  const dir = path.dirname(abs);
  const mod = { exports: {} };
  const req = (spec) => {
    if (typeof spec === 'string' && /^\.{1,2}[\\/]/.test(spec)) {
      for (const cand of [spec, spec + '.js', spec + '.cjs', spec + '.mjs', spec + '.json', path.join(spec, 'index.js')]) {
        const p = path.resolve(dir, cand);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          try { return runConfigFile(p, seen); } catch { return makeStub(); }
        }
      }
      return makeStub();
    }
    if (spec === 'tailwindcss/defaultTheme') {
      const real = { spacing: { ...DEFAULT_SPACING }, borderRadius: { ...DEFAULT_RADIUS }, boxShadow: { ...DEFAULT_SHADOWS } };
      return new Proxy(real, { get: (t, p) => (p in t ? t[p] : typeof p === 'symbol' ? undefined : makeStub()) });
    }
    return makeStub();
  };
  const ctx = vm.createContext({
    module: mod, exports: mod.exports, require: req, __req: req,
    __interop: (m) => (m && typeof m === 'object' && 'default' in m ? m.default : m),
    __dirname: dir, __filename: abs, process: { env: {}, platform: process.platform, cwd: () => dir },
    console: { log() {}, warn() {}, error() {}, info() {} },
  });
  vm.runInContext(transformSource(text), ctx, { filename: abs, timeout: 3000 });
  const ex = mod.exports;
  return ex && typeof ex === 'object' && Object.keys(ex).length === 1 && ex.default ? ex.default : ex;
}

/** Parse `--name: value;` declarations from CSS text (first definition wins). */
export function parseCssVariables(css) {
  const out = {};
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)[;}]/g;
  let m;
  while ((m = re.exec(text))) if (!(m[1] in out)) out[m[1]] = m[2].trim();
  return out;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function lenPx(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return NaN;
  return m[2] === 'rem' || m[2] === 'em' ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
}

function hslToRgba(h, s, l, a = 1) {
  s /= 100; l /= 100; h = ((h % 360) + 360) % 360;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4), a };
}

/** Parse a colour string from a Tailwind config; null when unsupported (keywords, oklch, unresolved var()). */
export function parseConfigColour(raw, resolveVar) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  for (let i = 0; i < 4 && /var\(/.test(s); i++) {
    s = s.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name, fb) => {
      const v = resolveVar ? resolveVar(name) : undefined;
      return v != null ? String(v) : fb != null ? fb.trim() : `\u0000${name}`;
    });
  }
  if (s.includes('\u0000')) return null;
  s = s.replace(/\s*\/\s*<alpha-value>\)/, ')').replace(/<alpha-value>/g, '1');
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return toRgba(s);
  const c = parseCssColour(s);
  if (c) return c;
  const m = /^hsla?\(\s*([\d.]+)(?:deg)?[ ,]+([\d.]+)%[ ,]+([\d.]+)%(?:[ ,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) return hslToRgba(+m[1], +m[2], +m[3], m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
  const t = /^([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)$/.exec(s);
  if (t && +t[1] <= 255) return { r: +t[1] / 255, g: +t[2] / 255, b: +t[3] / 255, a: 1 };
  return null;
}

function parseShadow(str, resolveVar) {
  if (typeof str !== 'string' || !str.trim() || str.trim() === 'none') return null;
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const out = [];
  for (const p of parts) {
    let t = p.trim();
    const inset = /\binset\b/.test(t);
    t = t.replace(/\binset\b/, '').trim();
    const cm = /((?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8})/i.exec(t);
    if (!cm) return null;
    const c = parseConfigColour(cm[1], resolveVar);
    if (!c) return null;
    const nums = t.replace(cm[1], '').trim().split(/\s+/).map(lenPx);
    if (nums.length < 2 || nums.some(Number.isNaN)) return null;
    const [x, y, blur = 0, spread = 0] = nums;
    out.push({ c, x, y, blur, spread, ...(inset ? { inset: true } : {}) });
  }
  return out.length ? out : null;
}

function mergeDeep(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? mergeDeep(a[k], v) : v;
  return out;
}

const THEME_KEYS = ['colors', 'spacing', 'borderRadius', 'fontSize', 'fontFamily', 'boxShadow'];

function resolveTheme(config) {
  const base = isObj(config) ? config : {};
  const presets = Array.isArray(base.presets) ? base.presets.filter(isObj) : [];
  const layers = [...presets.map((p) => p.theme || {}), base.theme || {}].filter(isObj);
  const replaces = {};
  for (const k of THEME_KEYS) replaces[k] = layers.some((l) => k in l);
  let resolved = {};
  const lookup = (p) => {
    let cur = resolved;
    for (const part of String(p).split('.')) { if (cur == null) return undefined; cur = cur[part]; }
    return cur;
  };
  const resolveVal = (v) => {
    if (typeof v !== 'function') return v;
    try { return v({ theme: lookup, colors: {}, rem: (x) => x }); } catch { return undefined; }
  };
  for (let pass = 0; pass < 2; pass++) {
    const next = {};
    for (const k of THEME_KEYS) {
      let acc;
      for (const layer of layers) {
        if (k in layer) { const v = resolveVal(layer[k]); if (v !== undefined) acc = v; }
        if (isObj(layer.extend) && k in layer.extend) {
          const v = resolveVal(layer.extend[k]);
          if (v !== undefined) acc = mergeDeep(acc === undefined ? {} : acc, v);
        }
      }
      next[k] = acc;
    }
    resolved = next;
  }
  return { theme: resolved, replaces };
}

function flattenColours(node, prefix, out, unresolved) {
  if (typeof node === 'string') { out.push({ name: prefix, raw: node }); return; }
  if (typeof node === 'function') {
    let v; try { v = node({ opacityValue: '1' }); } catch { v = undefined; }
    if (typeof v === 'string') out.push({ name: prefix, raw: v });
    else unresolved.push({ name: prefix, value: '[function]' });
    return;
  }
  if (!isObj(node)) return;
  for (const [k, v] of Object.entries(node)) {
    flattenColours(v, k === 'DEFAULT' ? prefix : prefix ? `${prefix}-${k}` : k, out, unresolved);
  }
}

/** Build the model from an already-evaluated config object. */
export function tailwindFromConfig(config, opts = {}) {
  const useDefaults = opts.defaults !== false;
  const resolveVar = opts.resolveVar || (opts.cssVars ? (n) => opts.cssVars[n] : undefined);
  const { theme, replaces } = resolveTheme(config);
  const unresolved = [];

  const flat = [];
  flattenColours(theme.colors, '', flat, unresolved);
  const colors = [];
  const names = new Set();
  for (const { name, raw } of flat) {
    if (!name || /^(transparent|current|currentcolor|inherit)$/i.test(raw)) continue;
    const rgba = parseConfigColour(raw, resolveVar);
    if (!rgba) { unresolved.push({ name, value: raw }); continue; }
    colors.push({ name, rgba, raw });
    names.add(name);
  }
  if (useDefaults) for (const [name, hex] of Object.entries(DEFAULT_COLORS)) if (!names.has(name)) colors.push({ name, rgba: toRgba(hex), raw: hex });

  const spacing = {};
  const spSrc = { ...(useDefaults && !replaces.spacing ? DEFAULT_SPACING : {}), ...(isObj(theme.spacing) ? theme.spacing : {}) };
  for (const [k, v] of Object.entries(spSrc)) { const px = lenPx(v); if (Number.isFinite(px)) spacing[k] = px; }
  const radius = {};
  const rSrc = { ...(useDefaults && !replaces.borderRadius ? DEFAULT_RADIUS : {}), ...(isObj(theme.borderRadius) ? theme.borderRadius : {}) };
  for (const [k, v] of Object.entries(rSrc)) { const px = lenPx(v); if (Number.isFinite(px) && px > 0 && px < 999) radius[k] = px; }

  const fontSize = [];
  if (isObj(theme.fontSize)) {
    for (const [name, v] of Object.entries(theme.fontSize)) {
      const arr = Array.isArray(v) ? v : [v];
      const size = lenPx(arr[0]);
      if (!Number.isFinite(size)) continue;
      let lh = null, weight = null;
      const extra = arr[1];
      if (typeof extra === 'string' || typeof extra === 'number') lh = lenPx(extra);
      else if (isObj(extra)) {
        if (extra.lineHeight != null) lh = lenPx(extra.lineHeight);
        if (extra.fontWeight != null) weight = Number(extra.fontWeight) || null;
      }
      if (Number.isFinite(lh) && lh < 4) lh = Math.round(lh * size * 100) / 100;
      fontSize.push({ name, size, lh: Number.isFinite(lh) ? lh : null, weight });
    }
  }

  const shadows = [];
  const shSrc = { ...(useDefaults && !replaces.boxShadow ? DEFAULT_SHADOWS : {}), ...(isObj(theme.boxShadow) ? theme.boxShadow : {}) };
  for (const [name, v] of Object.entries(shSrc)) {
    const sh = parseShadow(v, resolveVar);
    if (sh) shadows.push({ name, key: effectKey(sh) });
  }

  const fontFamily = {};
  if (isObj(theme.fontFamily)) {
    for (const [k, v] of Object.entries(theme.fontFamily)) fontFamily[k] = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string');
  }
  return { colors, radius, spacing, fontSize, shadows, fontFamily, unresolved, defaults: useDefaults };
}

/** Evaluate a tailwind config file (.js/.cjs/.mjs/.ts) and build the model. Throws with a clear message on failure. */
export function loadTailwind(file, opts = {}) {
  let cfg;
  try { cfg = runConfigFile(file); } catch (e) { throw new Error(`cannot evaluate tailwind config ${file}: ${e.message}`); }
  if (typeof cfg === 'function') { try { cfg = cfg(); } catch { cfg = {}; } }
  return tailwindFromConfig(cfg, opts);
}

/** Model with only the built-in defaults (or nothing with defaults:false). */
export const emptyTailwind = (defaults = false) => tailwindFromConfig({}, { defaults });
