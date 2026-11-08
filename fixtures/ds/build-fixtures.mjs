// Generates every file in fixtures/ds/ from one small, generic, fictional app (a settings page, a list page and a dialog).
// Nothing here is derived from a real export. Run:  node fixtures/ds/build-fixtures.mjs
//
// The enriched sample and the library are written by applying, by construction, exactly the rules a correct
// tokens.mjs / componentize.mjs must apply (see fixtures/ds/README.md "Derivation"). The inputs that those tools read
// (plain-sample.figma.json, ds.config.json, ds-inventory.json, component-decisions.json, tailwind.config.cjs) are
// produced here too, so colours, ids and counts stay consistent between all fixture files.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hexToRgba, rgbaToHex, colourKey, parseCssColour, toRgba, parseColourKey } from '../../tools/ds/common/colour.mjs';
import { textStyleKey, radiusKey, spacingKey, effectKey, sizeKey } from '../../tools/ds/common/keys.mjs';
import { hashStr, componentId, iconId } from '../../tools/ds/common/hash.mjs';
import { makeView } from '../../tools/ds/common/view.mjs';
import { digestView } from '../../tools/ds/common/hash.mjs';
import { validate } from '../../tools/ds/common/validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (f, o) => fs.writeFileSync(path.join(here, f), JSON.stringify(o, null, 1) + '\n');
const GEN = '2026-11-07T00:00:00.000Z';
const r4 = (x) => Math.round(x * 10000) / 10000;
const r2 = (x) => Math.round(x * 100) / 100;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ================================================================= palette, icons, text styles
const HEX = { page: 'f5f6f8', surface: 'fcfcfd', line: 'e2e5ea', ink: '1f2430', dim: '6b7280', accent: '2f6fed', muted: 'e8ebf0', white: 'ffffff', black: '000000' };
const col = (hex, a = 1) => { const c = hexToRgba('#' + hex, a); return { r: r4(c.r), g: r4(c.g), b: r4(c.b), a }; };
const ICON_D = {
  plus: ['Plus', 'M12 5v14M5 12h14'],
  user: ['User', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0'],
  bell: ['Bell', 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9ZM10 21h4'],
  chevron: ['ChevronRight', 'm9 18 6-6-6-6'],
};
// NOTE: geom here is a synthetic stand-in: hashStr(path data). T5 (tools/ds/icons/svgsig.mjs) owns the real iconSig;
// regenerate these fixtures if it changes the algorithm.
const ICON = Object.fromEntries(Object.entries(ICON_D).map(([k, [name, d]]) => [k, { key: k, name, d, geom: hashStr(d, 10), id: iconId(hashStr(d, 10)) }]));
const svgOf = (ic, size, hex) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="rgb(${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[ic].d}"></path></svg>`;

const FONT = 'Inter';
const TS = {
  h1: { size: 24, weight: 700, lh: 32 },
  cardTitle: { size: 16, weight: 600, lh: 24 },
  body: { size: 14, weight: 400, lh: 20 },
  label: { size: 14, weight: 500, lh: 20 },
  caption: { size: 12, weight: 500, lh: 16 },
};

// ================================================================= node constructors (plain export schema)
const Z4 = [0, 0, 0, 0];
function text(str, st, hex, s = ['H', 'H']) {
  return {
    t: 'text', name: 'text', x: 0, y: 0, w: r2(str.length * st.size * 0.52), h: st.lh, text: str,
    font: { family: FONT, size: st.size, weight: st.weight, color: col(hex), lh: st.lh, ls: 0, align: 'start', deco: 'none', upper: false, dir: 'ltr' },
    fixed: false, ls: { s, tx: { l: 1, lh: st.lh } },
  };
}
function svgNode(ic, size, hex) {
  return { t: 'svg', name: 'svg', x: 0, y: 0, w: size, h: size, svg: svgOf(ic, size, hex), ls: { s: ['F', 'F'] }, _icon: ic };
}
function frame(name, style, ls, kids, size) {
  const n = { t: 'frame', name, x: 0, y: 0, w: 0, h: 0, ...style, ls: { s: ['H', 'H'], k: 'V', g: 0, g2: 0, p: [...Z4], pa: 'MIN', ca: 'MIN', bw: [...Z4], ...ls }, children: kids };
  if (size) { n.w = size[0]; n.h = size[1]; }
  if (!kids.length) delete n.children;
  return n;
}
const rowOf = (name, kids, ls = {}) => frame(name, {}, { k: 'H', g: 8, ca: 'CENTER', s: ['L', 'H'], ...ls }, kids);

function Button(label, { type = 'P', disabled = false, icon = null, padX = 16 } = {}) {
  const primary = type === 'P';
  const fg = primary ? HEX.white : HEX.ink;
  const kids = [];
  if (icon) kids.push(svgNode(icon, 16, fg));
  kids.push(text(label, TS.label, fg));
  const n = frame(`button · ${label}`, { fill: col(primary ? HEX.accent : HEX.muted), radius: 8, ...(disabled ? { opacity: 0.5 } : {}) },
    { k: 'H', g: 8, p: [12, padX, 12, padX], pa: 'CENTER', ca: 'CENTER', s: ['H', 'H'] }, kids);
  n._m = { kind: 'button', type: primary ? 'Primary' : 'Secondary', state: disabled ? 'Disabled' : 'Default', label, icon, dev: padX === 16 ? 0 : Math.abs(padX - 16) };
  return n;
}
function Badge(label) {
  return frame(`span · ${label}`, { fill: col(HEX.muted), radius: 10 }, { k: 'H', g: 0, p: [3, 8, 3, 8], pa: 'CENTER', ca: 'CENTER', s: ['H', 'H'] }, [text(label, TS.caption, HEX.dim)]);
}
function Card(title, body, a, b) {
  const n = frame(`article · ${title}`, { fill: col(HEX.surface), stroke: { c: col(HEX.line), w: [1, 1, 1, 1], style: 'solid' }, radius: 12 },
    { k: 'V', g: 12, p: [17, 17, 17, 17], bw: [1, 1, 1, 1], s: ['L', 'H'] },
    [text(title, TS.cardTitle, HEX.ink, ['L', 'H']), text(body, TS.body, HEX.dim, ['L', 'H']), rowOf('div', [a, b], { pa: 'MAX' })]);
  n._m = { kind: 'card', title, body };
  return n;
}
function Row(title, ic, iconHex) {
  const n = frame(`item · ${title}`, { fill: col(HEX.surface) }, { k: 'H', g: 12, p: [12, 16, 12, 16], pa: 'MIN', ca: 'CENTER', s: ['L', 'H'] },
    [svgNode(ic, 20, iconHex), text(title, TS.label, HEX.ink, ['L', 'H']), svgNode('chevron', 20, HEX.dim)]);
  n._m = { kind: 'row', title, icon: ic };
  return n;
}
const List = (rows) => frame('list', {}, { k: 'V', g: 0, s: ['L', 'H'] }, rows);
const Header = (title, badge) => rowOf('header', [text(title, TS.h1, HEX.ink), Badge(badge)]);
const Page = (name, kids) => frame(name, { fill: col(HEX.page), clip: true }, { k: 'V', g: 16, p: [24, 16, 24, 16], s: ['F', 'F'] }, kids, [390, 844]);

// ================================================================= tiny layout engine (just enough to give nodes plausible boxes)
const isAbs = (k) => k.ls && k.ls.abs;
function measure(n) {
  if (n.t !== 'frame') return [n.w, n.h];
  const kids = n.children || [];
  const nat = kids.map(measure);
  const flow = kids.map((k, i) => ({ k, nat: nat[i] })).filter((x) => !isAbs(x.k));
  const { p = Z4, g = 0, k } = n.ls;
  const padH = p[1] + p[3], padV = p[0] + p[2];
  let w, h;
  if (k === 'V') {
    const ws = flow.filter((x) => x.k.ls.s[0] !== 'L').map((x) => x.nat[0]);
    w = (ws.length ? Math.max(...ws) : 0) + padH;
    h = flow.filter((x) => x.k.ls.s[1] !== 'L').reduce((a, x) => a + x.nat[1], 0) + g * Math.max(0, flow.length - 1) + padV;
  } else if (k === 'H') {
    w = flow.filter((x) => x.k.ls.s[0] !== 'L').reduce((a, x) => a + x.nat[0], 0) + g * Math.max(0, flow.length - 1) + padH;
    h = (flow.length ? Math.max(...flow.map((x) => x.nat[1])) : 0) + padV;
  } else { w = n.w; h = n.h; }
  n._nat = [r2(w), r2(h)];
  return n._nat;
}
function place(n, w, h) {
  n.w = r2(w); n.h = r2(h);
  if (n.t !== 'frame' || !n.children) return;
  const { p = Z4, g = 0, k, pa, ca } = n.ls;
  const iw = n.w - p[1] - p[3], ih = n.h - p[0] - p[2];
  const flow = n.children.filter((c) => !isAbs(c));
  const natOf = (c) => (c.t === 'frame' ? c._nat : [c.w, c.h]);
  if (k === 'V') {
    let y = p[0];
    const used = flow.reduce((a, c) => a + natOf(c)[1], 0) + g * Math.max(0, flow.length - 1);
    if (pa === 'CENTER') y += (ih - used) / 2; else if (pa === 'MAX') y += ih - used;
    for (const c of flow) {
      const [nw, nh] = natOf(c);
      const cw = c.ls.s[0] === 'L' ? iw : nw;
      let x = p[3]; if (c.ls.s[0] !== 'L') { if (ca === 'CENTER') x += (iw - cw) / 2; else if (ca === 'MAX') x += iw - cw; }
      c.x = r2(x); c.y = r2(y); place(c, cw, nh); y += nh + g;
    }
  } else if (k === 'H') {
    const fills = flow.filter((c) => c.ls.s[0] === 'L');
    const fixedW = flow.filter((c) => c.ls.s[0] !== 'L').reduce((a, c) => a + natOf(c)[0], 0) + g * Math.max(0, flow.length - 1);
    const each = fills.length ? (iw - fixedW) / fills.length : 0;
    const used = fills.length ? iw : fixedW;
    let x = p[3];
    if (!fills.length) { if (pa === 'CENTER') x += (iw - used) / 2; else if (pa === 'MAX') x += iw - used; }
    for (const c of flow) {
      const [nw, nh] = natOf(c);
      const cw = c.ls.s[0] === 'L' ? each : nw;
      let y = p[0]; if (ca === 'CENTER') y += (ih - nh) / 2; else if (ca === 'MAX') y += ih - nh;
      c.x = r2(x); c.y = r2(y); place(c, cw, nh); x += cw + g;
    }
  }
  for (const c of n.children.filter(isAbs)) { // absolute children: stretch / centre
    const cn = c.ls.cn || ['MIN', 'MIN'];
    if (cn[0] === 'STRETCH') { c.x = 0; c.w = n.w; } else if (cn[0] === 'CENTER') { c.x = r2((n.w - c.w) / 2); }
    if (cn[1] === 'STRETCH') { c.y = 0; c.h = n.h; } else if (cn[1] === 'CENTER') { c.y = r2((n.h - (c._nat ? c._nat[1] : c.h)) / 2); }
    if (c.t === 'frame' && c._nat) place(c, c.ls.s[0] === 'F' ? c.w : c._nat[0], c.ls.s[1] === 'F' ? c.h : c._nat[1]);
    if (cn[1] === 'CENTER') c.y = r2((n.h - c.h) / 2);
  }
}
function layoutRoot(root, w, h) { measure(root); place(root, w ?? root._nat[0], h ?? root._nat[1]); return root; }

// ================================================================= the three screens
function buildScreens() {
  const settings = Page('Settings / Default / 390', [
    Header('Settings', 'Beta'),
    Card('Profile', 'Update your name and contact details.', Button('Cancel', { type: 'S' }), Button('Save')),
    Card('Security', 'Change your password and sign-in options.', Button('Cancel', { type: 'S' }), Button('Save')),
    List([Row('Notifications', 'bell', HEX.accent), Row('Account', 'user', HEX.dim), Row('Privacy', 'user', HEX.dim)]),
  ]);
  const items = Page('Items / List / 390', [
    Header('Items', 'New'),
    List([Row('Item one', 'bell', HEX.accent), Row('Item two', 'user', HEX.dim), Row('Item three', 'bell', HEX.accent), Row('Item four', 'user', HEX.dim)]),
    Button('Add item', { icon: 'plus' }),
    Card('Summary', '4 items selected.', Button('Cancel', { type: 'S' }), Button('Apply', { disabled: true })),
  ]);
  const scrim = frame('overlay', { fill: col(HEX.black, 0.4) }, { k: 'N', abs: 1, cn: ['STRETCH', 'STRETCH'], s: ['F', 'F'] }, [], [390, 844]);
  delete scrim.ls.p; delete scrim.ls.bw; delete scrim.ls.pa; delete scrim.ls.ca; delete scrim.ls.g; delete scrim.ls.g2;
  const panel = frame('dialog', { fill: col(HEX.surface), radius: 16, shadow: [{ c: col(HEX.black, 0.2), x: 0, y: 8, blur: 24, spread: 0 }] },
    { k: 'V', g: 16, p: [24, 24, 24, 24], abs: 1, cn: ['CENTER', 'CENTER'], s: ['F', 'H'] },
    [rowOf('div', [text('Delete item?', TS.cardTitle, HEX.ink), Badge('Draft')]), text('This action cannot be undone.', TS.body, HEX.dim, ['L', 'H']),
      rowOf('div', [Button('Cancel', { type: 'S' }), Button('Delete', { padX: 17 })], { pa: 'MAX' })], [342, 0]);
  const dialog = Page('Items / Delete dialog / 390', [text('Items', TS.h1, HEX.ink), scrim, panel]);
  for (const s of [settings, items, dialog]) layoutRoot(s, 390, 844);
  return [settings, items, dialog];
}

// ================================================================= inputs: tailwind config, ds.config, inventory, decisions
const TAILWIND_CJS = `// Fixture Tailwind config (CommonJS, like a real project). Generic palette, not from any real app.
module.exports = {
  theme: {
    extend: {
      colors: {
        page: '#${HEX.page}', surface: '#${HEX.surface}', line: '#${HEX.line}', ink: '#${HEX.ink}', dim: '#${HEX.dim}',
        accent: { DEFAULT: '#${HEX.accent}' }, muted: '#${HEX.muted}', white: '#${HEX.white}', black: '#${HEX.black}',
      },
      borderRadius: { md: '8px', lg: '12px', xl: '16px', pill: '9999px' },
      spacing: { '0.5': '2px', 1: '4px', '1.5': '6px', 2: '8px', '2.5': '10px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px' },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
    },
  },
};
`;

const CONFIG = {
  $schema: '../../docs/ds-schema/config.schema.json',
  tailwind: './tailwind.config.cjs',
  thresholds: { occ: 3, occTiny: 4, tinyNodes: 6, screens: 2, minConf: 55, colorDeltaE: 1.5, alphaTol: 0.02, minUses: 3, minScreens: 2 },
  tokenMap: {
    page: { fill: 'bg/page' }, surface: { fill: 'bg/surface' }, line: { stroke: 'border/default' },
    ink: { text: 'text/primary', icon: 'icon/primary' }, dim: { text: 'text/dim', icon: 'icon/dim' },
    accent: { fill: 'bg/accent', icon: 'icon/accent' }, white: { text: 'text/on-accent', icon: 'icon/on-accent' },
    black: { fill: 'bg/scrim', shadow: 'effect/shadow' },
  },
  textStyleNames: {
    [textStyleKey({ family: FONT, ...TS.body, ls: 0 })]: 'Text/Body 14 Regular',
    [textStyleKey({ family: FONT, ...TS.label, ls: 0 })]: 'Text/Label 14 Medium',
    [textStyleKey({ family: FONT, ...TS.cardTitle, ls: 0 })]: 'Text/Card Title 16 Semibold',
    [textStyleKey({ family: FONT, ...TS.h1, ls: 0 })]: 'Text/Heading 24 Bold',
    [textStyleKey({ family: FONT, ...TS.caption, ls: 0 })]: 'Text/Caption 12 Medium',
  },
  nameHints: {
    roles: { button: 'Button', item: 'List Item', article: 'Card', dialog: 'Dialog', header: 'Page Header' },
    shapes: [{ match: { h: 64, fixedBottom: true }, name: 'Bottom Nav' }],
    groups: { Button: 'Buttons', Card: 'Cards', 'List Item': 'Lists' },
  },
  variantNames: { fill: { accent: 'Primary', muted: 'Secondary' } },
  fontMap: { Inter: 'Inter' },
  dsMode: 'report',
  exclude: ['*/Dialog/*'],
  scope: 'components',
};

const colVar = (id, name, hex, scopes, syntax) => ({
  id: `VariableID:1:${id}`, key: hashStr('var:' + name, 40), name, collection: 'VariableCollectionId:1:1', type: 'COLOR', scopes,
  valuesByMode: { '1:0': col(hex) }, ...(syntax ? { codeSyntax: { WEB: syntax } } : {}),
});
const numVar = (id, name, v, scopes) => ({
  id: `VariableID:1:${id}`, key: hashStr('var:' + name, 40), name, collection: 'VariableCollectionId:1:2', type: 'FLOAT', scopes, valuesByMode: { '1:1': v },
});
const FILL = ['FRAME_FILL', 'SHAPE_FILL'];
const buttonFp = (fill, label) => ({ t: 'frame', k: 'H', s: ['H', 'H'], fills: [fill], radius: 8, h: 44, pad: [12, 16, 12, 16], gap: 8, kids: [{ t: 'text', fills: [label] }] });
const INVENTORY = {
  $schema: '../../docs/ds-schema/inventory.schema.json', version: 1, file: 'Sample Design System', generated: GEN,
  collections: [
    { id: 'VariableCollectionId:1:1', name: 'Color', modes: [{ id: '1:0', name: 'Light' }] },
    { id: 'VariableCollectionId:1:2', name: 'Layout', modes: [{ id: '1:1', name: 'Value' }] },
  ],
  variables: [
    colVar(10, 'bg/page', HEX.page, FILL, 'colors.page'), colVar(11, 'bg/surface', HEX.surface, FILL, 'colors.surface'),
    colVar(12, 'bg/accent', HEX.accent, FILL, 'colors.accent'), colVar(13, 'bg/chip', HEX.muted, FILL), colVar(14, 'bg/secondary-button', HEX.muted, FILL),
    colVar(15, 'border/default', HEX.line, ['STROKE_COLOR'], 'colors.line'), colVar(16, 'text/primary', HEX.ink, ['TEXT_FILL'], 'colors.ink'),
    colVar(17, 'text/dim', HEX.dim, ['TEXT_FILL'], 'colors.dim'),
    numVar(20, 'radius/md', 8, ['CORNER_RADIUS']), numVar(21, 'radius/lg', 12, ['CORNER_RADIUS']),
    numVar(22, 'spacing/2', 8, ['GAP']), numVar(23, 'spacing/3', 12, ['GAP']), numVar(24, 'spacing/4', 16, ['GAP']),
  ],
  paintStyles: [],
  textStyles: [{
    id: 'S:text-body', key: hashStr('style:Text/Body 14 Regular', 40), name: 'Text/Body 14 Regular', fontName: { family: FONT, style: 'Regular' }, fontSize: 14,
    lineHeight: { unit: 'PIXELS', value: 20 }, letterSpacing: { unit: 'PERCENT', value: 0 },
  }],
  effectStyles: [],
  components: [
    {
      id: '3:10', key: hashStr('cmp:Button', 40), name: 'Button', type: 'COMPONENT_SET', page: '00 Design System',
      props: {
        Style: { type: 'VARIANT', defaultValue: 'Accent', variantOptions: ['Accent', 'Neutral'] },
        State: { type: 'VARIANT', defaultValue: 'Default', variantOptions: ['Default', 'Disabled'] },
        Label: { type: 'TEXT', defaultValue: 'Button' }, 'Show icon': { type: 'BOOLEAN', defaultValue: false },
        Icon: { type: 'INSTANCE_SWAP', defaultValue: '3:2' },
      },
      variants: ['Style=Accent, State=Default', 'Style=Neutral, State=Default', 'Style=Accent, State=Disabled'],
      fingerprint: { variants: { 'Style=Accent, State=Default': buttonFp('c:2f6fed@100', 'c:ffffff@100'), 'Style=Neutral, State=Default': buttonFp('c:e8ebf0@100', 'c:1f2430@100'), 'Style=Accent, State=Disabled': buttonFp('c:2f6fed@100', 'c:ffffff@100') } },
    },
    {
      id: '3:20', key: hashStr('cmp:Divider', 40), name: 'Divider', type: 'COMPONENT', page: '00 Design System', props: {},
      fingerprint: { t: 'frame', k: 'N', s: ['L', 'F'], fills: ['c:e2e5ea@100'], h: 1, kids: [] },
    },
  ],
  icons: [
    { id: '3:2', key: hashStr('icon:Bell', 40), name: 'Bell', geom: ICON.bell.geom },
    { id: '3:3', key: hashStr('icon:User', 40), name: 'User', geom: ICON.user.geom },
  ],
};

// ================================================================= clone helpers
const stripMeta = (n) => {
  const o = {};
  for (const [k, v] of Object.entries(n)) if (!k.startsWith('_')) o[k] = v;
  if (n.children) o.children = n.children.map(stripMeta);
  return o;
};
function walk(n, fn, parent = null) { fn(n, parent); (n.children || []).forEach((c) => walk(c, fn, n)); }

// ================================================================= tokens: harvest (spec 4.1), snap-free, then targets/status
const require = createRequire(import.meta.url);
function loadTailwind() {
  const f = path.join(here, 'tailwind.config.cjs');
  fs.writeFileSync(f, TAILWIND_CJS);
  const ext = require(f).theme.extend;
  const colours = {};
  for (const [k, v] of Object.entries(ext.colors)) colours[k] = typeof v === 'string' ? v : v.DEFAULT;
  const px = (s) => parseFloat(s);
  return {
    colours,
    radius: Object.fromEntries(Object.entries(ext.borderRadius).filter(([, v]) => v.endsWith('px') && px(v) < 999).map(([k, v]) => [k, px(v)])),
    spacing: Object.fromEntries(Object.entries(ext.spacing).map(([k, v]) => [k, px(v)])),
  };
}

function harvest(screens) {
  const uses = new Map(); // `${family}|${key}|${role}` -> { family, key, role, count, screens:Set }
  const use = (family, key, role, si) => {
    if (!key) return;
    if (family !== 'c') role = ''; // only colours are split by role (CONTRACT-NOTES #8)
    const id = `${family}|${key}|${role}`;
    if (!uses.has(id)) uses.set(id, { family, key, role, count: 0, screens: new Set() });
    const u = uses.get(id); u.count++; u.screens.add(si);
  };
  let nodes = 0;
  screens.forEach((root, si) => walk(root, (n) => {
    nodes++;
    const ls = n.ls || {};
    if (n.t === 'frame') {
      if (n.fill) use('c', colourKey(n.fill), 'fill', si);
      if (n.stroke) use('c', colourKey(n.stroke.c), 'stroke', si);
      for (const s of n.shadow || []) use('c', colourKey(s.c), 'shadow', si);
      use('r', radiusKey(n.radius), 'radius', si);
      if (ls.k !== 'N') {
        if (ls.g > 0 && ls.g <= 128) use('sp', spacingKey(ls.g), 'gap', si);
        if (ls.g2 > 0 && ls.g2 <= 128) use('sp', spacingKey(ls.g2), 'gap', si);
        (ls.p || []).forEach((v, i) => { const inner = r2(v - (ls.bw || Z4)[i]); if (inner > 0) use('sp', spacingKey(inner), 'padding', si); });
      }
      if (n.shadow && n.shadow.length) use('e', effectKey(n.shadow), 'effect', si);
      if (/^button\b/.test(n.name)) use('sz', sizeKey(n.h), 'size', si);
    } else if (n.t === 'text') {
      use('c', colourKey(n.font.color), 'text', si);
      use('t', textStyleKey(n.font), 'text', si);
    } else if (n.t === 'svg') {
      const m = /<svg\b[^>]*\bstroke="([^"]+)"/.exec(n.svg);
      const c = m && parseCssColour(m[1]);
      if (c) use('c', colourKey(c), 'icon', si);
    }
  }));
  return { uses, nodes };
}

const SCOPES = { fill: FILL, text: ['TEXT_FILL'], stroke: ['STROKE_COLOR'], icon: ['SHAPE_FILL', 'STROKE_COLOR'], shadow: ['EFFECT_COLOR'] };
const PREFIX = { fill: 'bg', text: 'text', stroke: 'border', icon: 'icon', shadow: 'effect' };

function buildTokens(screens, tw) {
  const { uses, nodes } = harvest(screens);
  const th = CONFIG.thresholds;
  const varByName = (coll, name) => {
    const c = INVENTORY.collections.find((x) => x.name === coll);
    return INVENTORY.variables.find((v) => v.collection === c.id && v.name === name);
  };
  const existing = (coll, name) => { const v = varByName(coll, name); return v ? { id: v.id, name: `${coll}/${v.name}` } : null; };
  const thresholdStatus = (u) => (u.count >= th.minUses && u.screens.size >= th.minScreens ? 'create' : 'skip');
  const sorted = (family) => [...uses.values()].filter((u) => u.family === family).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key) || a.role.localeCompare(b.role));

  // ---- colours
  const colors = sorted('c').map((u) => {
    const pc = parseColourKey(u.key);
    const twName = Object.entries(tw.colours).find(([, hx]) => {
      const a = toRgba(hx), b = pc.rgba; return [0, 1, 2].every((i) => Math.abs(Math.round([a.r, a.g, a.b][i] * 255) - Math.round([b.r, b.g, b.b][i] * 255)) <= 1);
    });
    const e = { key: u.key, role: u.role, hex: pc.hex, a: pc.a, count: u.count, screens: u.screens.size, roles: { [u.role]: u.count } };
    let name = null;
    if (twName) {
      e.tailwind = pc.pct === 100 ? twName[0] : `${twName[0]}/${pc.pct}`;
      const mapped = CONFIG.tokenMap[twName[0]] && CONFIG.tokenMap[twName[0]][u.role];
      if (mapped) name = pc.pct === 100 ? mapped : `${mapped}-${pc.pct}`;
      else name = `${PREFIX[u.role]}/${twName[0]}${pc.pct === 100 ? '' : '-' + pc.pct}`;
    } else name = `${PREFIX[u.role]}/${u.key.slice(2, 8)}`;
    e.target = { collection: 'Color', name, type: 'COLOR', scopes: SCOPES[u.role] };
    e.existing = existing('Color', name);
    if (e.existing) e.status = 'bound';
    else {
      const cands = INVENTORY.variables.filter((v) => v.type === 'COLOR' && v.scopes.some((s) => SCOPES[u.role].includes(s)) && rgbaToHex(Object.values(v.valuesByMode)[0]) === pc.hex && Math.abs(Object.values(v.valuesByMode)[0].a - pc.a) < 0.005);
      if (cands.length) { e.status = 'review'; e.candidates = cands.map((v) => ({ id: v.id, name: `Color/${v.name}` })); }
      else e.status = thresholdStatus(u);
    }
    if (e.status === 'skip') { delete e.target; delete e.existing; }
    return e;
  });

  // ---- text styles
  const textStyles = sorted('t').map((u) => {
    const styleName = CONFIG.textStyleNames[u.key];
    const e = { key: u.key, count: u.count, screens: u.screens.size };
    const ex = INVENTORY.textStyles.find((s) => s.name === styleName);
    e.target = { name: styleName };
    e.existing = ex ? { id: ex.id, name: ex.name } : null;
    e.status = ex ? 'bound' : thresholdStatus(u);
    if (e.status === 'skip') { delete e.target; delete e.existing; }
    return e;
  });

  // ---- radii, spacing
  const nearest = (value, table, prefix) => {
    let best = null;
    for (const [k, v] of Object.entries(table)) if (best === null || Math.abs(v - value) < Math.abs(best[1] - value)) best = [k, v];
    return `${prefix}/${best[0]}(${best[1]})`;
  };
  const radii = sorted('r').map((u) => {
    const px = Number(u.key.slice(2));
    const twk = Object.entries(tw.radius).find(([, v]) => v === px);
    const e = { key: u.key, count: u.count, screens: u.screens.size };
    if (twk) e.tailwind = `rounded-${twk[0]}`;
    if (twk) {
      e.target = { collection: 'Layout', name: `radius/${twk[0]}`, type: 'FLOAT', scopes: ['CORNER_RADIUS'] };
      e.existing = existing('Layout', e.target.name);
      e.status = e.existing ? 'bound' : thresholdStatus(u);
    } else {
      e.status = thresholdStatus(u) === 'skip' ? 'skip' : 'off-scale';
      if (e.status === 'off-scale') e.nearest = nearest(px, tw.radius, 'radius');
    }
    if (e.status === 'skip') { delete e.target; delete e.existing; }
    return e;
  });
  const spacing = sorted('sp').map((u) => {
    const px = Number(u.key.slice(3));
    const twk = Object.entries(tw.spacing).find(([, v]) => v === px);
    const e = { key: u.key, count: u.count, screens: u.screens.size };
    if (twk) {
      e.tailwind = `p-${twk[0]}`;
      e.target = { collection: 'Layout', name: `spacing/${twk[0]}`, type: 'FLOAT', scopes: ['GAP'] };
      e.existing = existing('Layout', e.target.name);
      e.status = e.existing ? 'bound' : thresholdStatus(u);
    } else {
      e.status = thresholdStatus(u) === 'skip' ? 'skip' : 'off-scale';
      if (e.status === 'off-scale') e.nearest = nearest(px, tw.spacing, 'spacing');
    }
    if (e.status === 'skip') { delete e.target; delete e.existing; }
    return e;
  });

  // ---- effects, sizes
  const effects = sorted('e').map((u) => {
    const e = { key: u.key, count: u.count, screens: u.screens.size, status: thresholdStatus(u) };
    if (e.status === 'create') e.target = { style: 'Shadow/Dialog' };
    return e;
  });
  const sizes = sorted('sz').map((u) => ({
    key: u.key, count: u.count, screens: u.screens.size, status: thresholdStatus(u),
    ...(thresholdStatus(u) === 'create' ? { target: { collection: 'Layout', name: 'size/control', type: 'FLOAT', scopes: ['WIDTH_HEIGHT'] } } : {}),
  }));

  const findings = [];
  for (const r of radii) if (r.status === 'off-scale') findings.push(`radius ${r.key.slice(2)} used ${r.count}x: off-scale (nearest ${r.nearest})`);
  for (const s of spacing) if (s.status === 'off-scale') findings.push(`spacing ${s.key.slice(3)} used ${s.count}x: off-scale (nearest ${s.nearest})`);
  for (const s of spacing) if (s.status === 'skip') findings.push(`spacing ${s.key.slice(3)} used ${s.count}x on ${s.screens} screen(s): below thresholds, stays literal`);
  for (const c of colors) if (c.status === 'review') findings.push(`${c.key} (${c.role}) matches ${c.candidates.length} existing variables (${c.candidates.map((x) => x.name).join(', ')}): decide manually`);

  const tokens = {
    $schema: '../../docs/ds-schema/tokens.schema.json', version: 1, generated: GEN,
    source: { files: 1, screens: screens.length, nodes },
    config: { colorDeltaE: th.colorDeltaE, alphaTol: th.alphaTol, minUses: th.minUses, minScreens: th.minScreens },
    colors, gradients: [], textStyles, radii, spacing, effects, sizes, findings,
  };
  return tokens;
}

// ================================================================= tok annotation (what annotate.mjs must produce)
function makeAnnotator(tokens) {
  const live = (e) => e && ['bound', 'create', 'review'].includes(e.status);
  const idx = (arr, f) => new Map(arr.map((e) => [f(e), e]));
  const colours = idx(tokens.colors, (e) => `${e.key}|${e.role}`);
  const simple = new Map([...tokens.textStyles, ...tokens.radii, ...tokens.spacing, ...tokens.effects, ...tokens.sizes].map((e) => [e.key, e]));
  const ck = (key, role) => (live(colours.get(`${key}|${role}`)) ? key : undefined);
  const sk = (key) => (key && live(simple.get(key)) ? key : undefined);
  return function tok(n) {
    const ls = n.ls || {};
    const t = {};
    if (n.t === 'frame' || n.t === 'img') {
      if (n.fill) t.f = ck(colourKey(n.fill), 'fill');
      if (n.stroke) t.s = ck(colourKey(n.stroke.c), 'stroke');
      t.r = sk(radiusKey(n.radius));
      if (ls.k !== 'N') {
        if (ls.g > 0) t.g = sk(spacingKey(ls.g));
        if (ls.g2 > 0) t.g2 = sk(spacingKey(ls.g2));
        const p = (ls.p || Z4).map((v, i) => { const inner = r2(v - (ls.bw || Z4)[i]); return inner > 0 ? sk(spacingKey(inner)) || null : null; });
        if (p.some((x) => x)) t.p = p;
      }
      if (n.shadow && n.shadow.length) t.e = sk(effectKey(n.shadow));
    } else if (n.t === 'text') {
      t.tx = ck(colourKey(n.font.color), 'text');
      t.ts = sk(textStyleKey(n.font));
    } else if (n.t === 'svg') {
      const m = /<svg\b[^>]*\bstroke="([^"]+)"/.exec(n.svg);
      const c = m && parseCssColour(m[1]);
      if (c) t.ic = ck(colourKey(c), 'icon');
    }
    for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
    return Object.keys(t).length ? t : null;
  };
}

// ================================================================= componentize: instances, overrides, library
const ids = {};
function main() {
  const tw = loadTailwind();
  const plainScreens = buildScreens();
  const tokens = buildTokens(plainScreens.map(stripMeta), tw);
  const tok = makeAnnotator(tokens);

  // ---- 1. annotate tok on every node of a (meta-carrying) tree, returns a deep copy with tok and cmp
  const designed = plainScreens.map((s) => s);

  // ---- 2. component statistics over the plain screens
  const occ = { button: [], card: [], row: [] };
  designed.forEach((root, si) => walk(root, (n) => { if (n._m) occ[n._m.kind].push({ n, si, nested: false }); }));
  const dialogBtn = new Set();
  // nodes: kids of Card instances count as nested (still instances in their own right)

  const leaderBtn = occ.button.find((o) => o.n._m.label === 'Save').n;
  const leaderCard = occ.card[0].n;
  const leaderRow = occ.row[0].n;

  // exemplar builders (plain, superset with icon where relevant)
  const exemplar = (b) => { const e = layoutRoot(Button(b.label, { type: b.type === 'Primary' ? 'P' : 'S', disabled: b.state === 'Disabled', icon: 'plus' })); return e; };
  const btnSig = (b) => `${b.type}/${b.state}`;
  const variantsSeen = new Map();
  for (const o of occ.button) { const m = o.n._m; const k = btnSig(m); if (!variantsSeen.has(k)) variantsSeen.set(k, { m, n: 0 }); variantsSeen.get(k).n++; }

  // ---- 3. icon library
  const iconUse = {};
  designed.forEach((root) => walk(root, (n) => { if (n._icon) { const u = (iconUse[n._icon] = iconUse[n._icon] || { sizes: {}, colours: {} }); u.sizes[n.w] = (u.sizes[n.w] || 0) + 1; const ckey = colourKey(parseCssColour(/stroke="([^"]+)"/.exec(n.svg)[1])); u.colours[ckey] = (u.colours[ckey] || 0) + 1; } }));
  const dominant = (u) => Object.entries(u.colours).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const icKeyOf = (n) => colourKey(parseCssColour(/stroke="([^"]+)"/.exec(n.svg)[1]));
  const iconCmp = (n) => {
    const cmp = { id: ICON[n._icon].id, kind: 'icon' };
    const ck = icKeyOf(n);
    const dom = dominant(iconUse[n._icon]);
    const liveTok = tokens.colors.find((e) => e.key === ck && e.role === 'icon' && ['bound', 'create', 'review'].includes(e.status));
    if (ck !== dom && liveTok) cmp.c = ck;
    return cmp;
  };

  // ---- 4. slots
  const BTN_SLOTS = [
    { s: '0', kind: 'bool', path: [0], name: 'Show icon', default: false },
    { s: '1', kind: 'swap', path: [0], name: 'Icon', default: ICON.plus.id },
    { s: '2', kind: 'text', path: [1], name: 'Label', default: 'Save' },
  ];
  const CARD_SLOTS = [
    { s: '0', kind: 'text', path: [0], name: 'Title', default: leaderCard._m.title },
    { s: '1', kind: 'text', path: [1], name: 'Body', default: leaderCard._m.body },
    { s: '2', kind: 'inst', path: [2, 0], name: 'Button 1' },
    { s: '3', kind: 'inst', path: [2, 1], name: 'Button 2' },
  ];
  const ROW_SLOTS = [
    { s: '0', kind: 'swap', path: [0], name: 'Icon', default: ICON.bell.id },
    { s: '1', kind: 'text', path: [1], name: 'Label', default: leaderRow._m.title },
  ];

  // ---- 5. variant maps of buttons + confidences
  const vOf = (m) => ({ Type: m.type, State: m.state });
  const devs = { button: occ.button.map((o) => o.n._m.dev), card: occ.card.map(() => 0), row: occ.row.map(() => 0) };
  const mean = (a) => r2(a.reduce((x, y) => x + y, 0) / a.length);
  const conf = (o) => {
    const rep = Math.min(1, Math.log2(o.occ) / 3);
    const cross = Math.min(1, o.screens / 4) * (o.files >= 2 ? 1 : 0.7);
    const size = o.nodes < 3 ? 0.3 : o.nodes > 80 ? 0.5 : 1;
    const cohesion = 1 - Math.min(1, o.meanDev / 4);
    return Math.round(100 * (0.22 * rep + 0.18 * cross + 0.1 * size + 0.25 * cohesion + 0.25 * 0.9)); // nameSource 'role' -> 0.9
  };
  const screensOf = (list) => new Set(list.map((o) => o.si)).size;
  const STAT = {
    button: { occ: occ.button.length, screens: screensOf(occ.button), files: 1, nodes: 3, meanDev: mean(devs.button) },
    card: { occ: occ.card.length, screens: screensOf(occ.card), files: 1, nodes: 6, meanDev: 0 },
    row: { occ: occ.row.length, screens: screensOf(occ.row), files: 1, nodes: 4, meanDev: 0 },
  };
  for (const k of Object.keys(STAT)) STAT[k].conf = conf(STAT[k]);
  const band = (c) => (c >= 80 ? 'auto' : 'review');

  // ---- 6. ids from the S digest of each leader (spec 5.3)
  const S_of = (n) => digestView(makeView(n, { collapse: false }), {}).S;
  ids.button = componentId('button', S_of(layoutRoot(Button('Save', { icon: 'plus' }))));
  const withBtnCmp = (n) => { const o = {}; for (const [k, v] of Object.entries(n)) if (!k.startsWith('_') && k !== 'children') o[k] = v; if (n._m && n._m.kind === 'button') o.cmp = { id: ids.button }; if (n.children) o.children = n.children.map(withBtnCmp); return o; };
  ids.card = componentId('card', digestView(makeView(withBtnCmp(leaderCard), { collapse: true }), {}).S);
  ids.row = componentId('list-item', S_of(stripMeta(leaderRow)));

  // ---- 7. produce enriched copies
  const CONF = { button: STAT.button.conf, card: STAT.card.conf, row: STAT.row.conf };
  function enrich(n) {
    const o = {};
    for (const [k, v] of Object.entries(n)) if (!k.startsWith('_') && k !== 'children') o[k] = v;
    const t = tok(n); if (t) o.tok = t;
    if (n._icon) o.cmp = iconCmp(n);
    if (n._m) o.cmp = cmpFor(n);
    if (n.children) o.children = n.children.map(enrich);
    return o;
  }
  function btnOv(m, leaderText = 'Save') {
    const ov = [];
    if (m.icon) ov.push({ s: '0', b: true });
    if (m.icon && m.icon !== 'plus') ov.push({ s: '1', ic: ICON[m.icon].id });
    if (m.label !== leaderText) ov.push({ s: '2', t: m.label });
    return ov;
  }
  function cmpFor(n) {
    const m = n._m;
    if (m.kind === 'button') {
      const c = { id: ids.button, v: vOf(m) };
      const ov = btnOv(m); if (ov.length) c.ov = ov;
      c.dev = m.dev; c.conf = CONF.button; return c;
    }
    if (m.kind === 'card') {
      const ov = [];
      if (m.title !== leaderCard._m.title) ov.push({ s: '0', t: m.title });
      if (m.body !== leaderCard._m.body) ov.push({ s: '1', t: m.body });
      const btns = n.children[2].children;
      btns.forEach((b, i) => {
        const slot = String(2 + i), lb = leaderCard.children[2].children[i]._m, bm = b._m;
        if (btnSig(bm) !== btnSig(lb)) ov.push({ s: slot, v: vOf(bm) });
        for (const o of btnOv(bm, lb.label)) { ov.push({ ...o, s: `${slot}.${o.s}` }); }
      });
      const c = { id: ids.card }; if (ov.length) c.ov = ov; c.dev = 0; c.conf = CONF.card; return c;
    }
    const ov = [];
    const ic = m.icon;
    const ckey = icKeyOf(n.children[0]);
    if (ic !== leaderRow._m.icon || ckey !== icKeyOf(leaderRow.children[0])) {
      const o = { s: '0', ic: ICON[ic].id };
      if (ckey !== icKeyOf(leaderRow.children[0]) && tokens.colors.some((e) => e.key === ckey && e.role === 'icon' && ['bound', 'create', 'review'].includes(e.status))) o.c = ckey;
      ov.push(o);
    }
    if (m.title !== leaderRow._m.title) ov.push({ s: '1', t: m.title });
    const c = { id: ids.row }; if (ov.length) c.ov = ov; c.dev = 0; c.conf = CONF.row; return c;
  }
  const enrichedFrames = designed.map(enrich);

  // ---- 8. library roots (exemplar subtrees, x/y 0, root has no cmp)
  const rootOf = (plain) => { const e = enrich(plain); delete e.cmp; e.x = 0; e.y = 0; return e; };
  const btnRoot = (b) => rootOf(exemplar(b));
  const leaderBtnRoot = btnRoot(leaderBtn._m);
  leaderBtnRoot.children[0].cmp = { id: ICON.plus.id, kind: 'icon' };
  const withIconCmp = (r) => { r.children[0].cmp = { id: ICON.plus.id, kind: 'icon' }; return r; };
  const members = [...variantsSeen.values()].map(({ m, n }) => ({ v: vOf(m), root: withIconCmp(btnRoot(m)), n }));
  const cardRoot = rootOf(leaderCard);
  const rowRoot = rootOf(leaderRow);
  // Button DS match info
  const library = {
    $schema: '../../docs/ds-schema/library.schema.json', version: 1, generated: GEN,
    params: { thresholds: CONFIG.thresholds, tolerance: { gap: 1, size: 'max(2px,2%)', font: 0, lh: 1, ls: 0.02, colorDeltaE: 1.5, alphaTol: 0.02 }, note: 'synthetic fixture generated by fixtures/ds/build-fixtures.mjs' },
    components: [
      {
        id: ids.button, name: 'Button', group: 'Buttons', conf: CONF.button, band: band(CONF.button), nameSource: 'role',
        ds: { id: '3:10', key: INVENTORY.components[0].key, name: 'Button', score: 0.88, mode: 'report', propMap: { Label: 'Label', 'Show icon': 'Show icon', Icon: 'Icon' },
          variantMap: [{ 'Type=Primary, State=Default': 'Style=Accent, State=Default' }, { 'Type=Secondary, State=Default': 'Style=Neutral, State=Default' }, { 'Type=Primary, State=Disabled': 'Style=Accent, State=Disabled' }] },
        root: leaderBtnRoot, slots: BTN_SLOTS,
        variants: { props: { Type: ['Primary', 'Secondary'], State: ['Default', 'Disabled'] }, members },
        stats: { occ: STAT.button.occ, screens: STAT.button.screens, files: 1, devMean: STAT.button.meanDev, devMax: Math.max(...devs.button) },
        notes: ['Variant combination Type=Secondary, State=Disabled never occurs (hole in the set).', 'Master root is the superset: the icon is hidden by default (slot 0 default false).', 'Delete button has 17px horizontal padding: merged within tolerance, dev 1.'],
      },
      {
        id: ids.card, name: 'Card', group: 'Cards', conf: CONF.card, band: band(CONF.card), nameSource: 'role',
        root: cardRoot, slots: CARD_SLOTS,
        stats: { occ: STAT.card.occ, screens: STAT.card.screens, files: 1, devMean: 0, devMax: 0 },
        notes: ['Nested instances: the two Buttons are slots 2 and 3 (override ids 2.x / 3.x address their inner slots).', 'Confidence in the review band on purpose.'],
      },
      {
        id: ids.row, name: 'List Item', group: 'Lists', conf: CONF.row, band: band(CONF.row), nameSource: 'role',
        root: rowRoot, slots: ROW_SLOTS,
        stats: { occ: STAT.row.occ, screens: STAT.row.screens, files: 1, devMean: 0, devMax: 0 },
        notes: ['Trailing chevron is a constant icon instance, not a slot.'],
      },
    ],
    icons: Object.values(ICON).map((ic) => {
      const u = iconUse[ic.key];
      return {
        id: ic.id, name: ic.name, geom: ic.geom, vb: [0, 0, 24, 24], kind: 'stroke', strokeWidth: 2,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ic.d}"></path></svg>`,
        sizes: Object.fromEntries(Object.entries(u.sizes).map(([k, v]) => [String(k), v])), vecPaths: [[0]],
        ...(INVENTORY.icons.find((x) => x.geom === ic.geom) ? { ds: { id: INVENTORY.icons.find((x) => x.geom === ic.geom).id, name: INVENTORY.icons.find((x) => x.geom === ic.geom).name } } : {}),
        dominantColor: dominant(u),
      };
    }),
  };

  const DECISIONS = {
    $schema: '../../docs/ds-schema/decisions.schema.json', version: 1,
    decisions: [
      { id: ids.card, action: 'accept', note: 'Looks right; promote from review to auto.' },
      { id: ids.row, action: 'rename', name: 'Lists/Settings Row', group: 'Lists' },
      { sig: 'sig-of-a-rejected-cluster', action: 'reject', note: 'Dialog panel is a one-off.' },
      { id: ids.button, action: 'split', by: 'size', note: 'Example only: split Button clusters by size.' },
    ],
    exclude: ['*/Dialog/*'],
  };

  const plainFile = { figmaLift: 1, name: 'plain-sample', frames: designed.map(stripMeta) };
  const enrichedFile = { figmaLift: 1, name: 'plain-sample', ds: { library: '_library.json', tokens: 'tokens.json', ver: 1 }, frames: enrichedFrames };

  out('plain-sample.figma.json', plainFile);
  out('enriched-sample.figma.json', enrichedFile);
  out('_library.json', library);
  out('tokens.json', tokens);
  out('ds.config.json', CONFIG);
  out('ds-inventory.json', INVENTORY);
  out('component-decisions.json', DECISIONS);

  // ---- self-check
  const bad = [];
  for (const [name, schema, data] of [['plain-sample', 'screen-file', plainFile], ['enriched-sample', 'screen-file', enrichedFile], ['_library', 'library', library], ['tokens', 'tokens', tokens], ['ds.config', 'config', CONFIG], ['ds-inventory', 'inventory', INVENTORY], ['component-decisions', 'decisions', DECISIONS]]) {
    const r = validate(schema, data);
    if (!r.ok) bad.push(`${name}: ${r.errors.slice(0, 5).map((e) => e.path + ' ' + e.message).join('; ')}`);
  }
  if (bad.length) { console.error('SELF-CHECK FAILED\n' + bad.join('\n')); process.exit(1); }
  console.log('fixtures written:', Object.keys(STAT).map((k) => `${k} occ=${STAT[k].occ} screens=${STAT[k].screens} conf=${STAT[k].conf}`).join(' | '));
}
main();
