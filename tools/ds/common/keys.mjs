// Token key formats (contract, see docs/ds-schema/CONTRACT-NOTES.md). All keys are plain strings.
//   colour   c:rrggbb@aa            aa = alpha*100 integer          (colour.mjs)
//   text     t:<family>/<size>/<weight>/<lh>/<ls_em>                'lh' in px, 'ls_em' = letter-spacing / size (3 decimals), '0' when none
//   radius   r:<n>  |  r:<tl>/<tr>/<br>/<bl>                        collapsed to r:<n> when all four are equal
//   spacing  sp:<n>                                                 px
//   effect   e:<shadow>[|<shadow>...]   shadow = [i]x,y,blur,spread,<rrggbb>@<aa>   ('i' prefix only for inset)
//   size     sz:h<n>
//   gradient g:<type>:<angle>:<stops>                               (not produced by the fixtures)
export { colourKey, parseColourKey, isColourKey } from './colour.mjs';
import { hex6, alphaPct, toRgba } from './colour.mjs';

const num = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export function textStyleKey(f) {
  const em = f.size ? Math.round(((f.ls || 0) / f.size) * 1000) / 1000 : 0;
  return `t:${f.family}/${num(f.size)}/${num(f.weight)}/${num(f.lh)}/${num(em)}`;
}
export function parseTextStyleKey(key) {
  const m = /^t:(.+)\/([\d.]+)\/(\d+)\/([\d.]+)\/(-?[\d.]+)$/.exec(key);
  if (!m) throw new TypeError(`bad text style key ${key}`);
  return { family: m[1], size: +m[2], weight: +m[3], lh: +m[4], lsEm: +m[5] };
}

export function radiusKey(r) {
  if (r == null) return null;
  const a = Array.isArray(r) ? r : [r, r, r, r];
  if (a.every((x) => !x)) return null;
  return a.every((x) => x === a[0]) ? `r:${num(a[0])}` : `r:${a.map(num).join('/')}`;
}
export const spacingKey = (n) => `sp:${num(n)}`;
export const sizeKey = (h) => `sz:h${num(h)}`;

export function effectKey(shadows) {
  if (!shadows || !shadows.length) return null;
  return 'e:' + shadows
    .map((s) => `${s.inset ? 'i' : ''}${num(s.x || 0)},${num(s.y || 0)},${num(s.blur || 0)},${num(s.spread || 0)},${hex6(s.c)}@${alphaPct(toRgba(s.c).a)}`)
    .join('|');
}

/** numeric value of a sp:/sz:/r: key (first corner for multi-corner radii) */
export function keyNumber(key) {
  const m = /^(?:sp|sz|r):h?(-?[\d.]+)/.exec(key);
  return m ? Number(m[1]) : NaN;
}
