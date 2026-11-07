import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectIcons, buildNameTable, iconSig, matchDsIcons } from './index.mjs';
import { clusterSigs, maxDev } from './cluster.mjs';
import { validate } from '../common/validate.mjs';

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/ds');
const readFx = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const svg = (inner, { size = 24, vb = '0 0 24 24', stroke = 'rgb(1, 2, 3)', sw = 2 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const node = (s, w = 16, extra = {}) => ({ t: 'svg', name: 'svg', x: 0, y: 0, w, h: w, svg: s, ...extra });
const file = (...kids) => ({ figmaLift: 1, frames: [{ t: 'frame', name: 'f', x: 0, y: 0, w: 100, h: 100, children: kids }] });

const CHEV = 'M9 18l6-6-6-6', PLUS = 'M5 12h14M12 5v14', SEARCH = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>';

test('collectIcons clusters, counts sizes, annotates, produces schema-valid LibIcons', () => {
  const a = node(svg(`<path d="${CHEV}"/>`), 16), b = node(svg('<path d="m9 18 6-6-6-6"/>', { size: 20, stroke: 'rgb(9, 9, 9)' }), 20), c = node(svg(`<path d="${PLUS}"/>`), 16);
  const f = file(a, b, { t: 'frame', name: 'x', x: 0, y: 0, w: 5, h: 5, children: [c, node(svg(`<path d="${CHEV}"/>`), 16)] });
  const r = collectIcons([f]);
  assert.equal(r.icons.length, 2);
  assert.equal(r.stats.svgNodes, 4);
  assert.equal(r.stats.iconNodes, 4);
  const chev = r.icons.find((i) => i.sizes['16'] === 2);
  assert.deepEqual(chev.sizes, { 16: 2, 20: 1 });
  assert.equal(a.cmp.id, chev.id);
  assert.equal(b.cmp.id, chev.id);
  assert.deepEqual(a.cmp.sz, [16, 16]);
  assert.equal(a.cmp.kind, 'icon');
  assert.equal(chev.dominantColor, 'c:010203@100');
  assert.equal(a.cmp.c, undefined);
  assert.equal(b.cmp.c, undefined); // differing colour but no live token: omitted (contract note 3)
  assert.match(chev.name, /^Icon \/ [0-9a-f]{6}$/);
  const lib = { version: 1, generated: 'x', components: [], icons: r.icons };
  const v = validate('library', lib);
  assert.ok(v === true || v.ok === true || (Array.isArray(v) && !v.length) || (v && v.errors && !v.errors.length), JSON.stringify(v).slice(0, 300));
});

test('cmp.c is written only for a differing colour with a live token', () => {
  const mk = (rgb, tok) => node(svg(`<path d="${CHEV}"/>`, { stroke: rgb }), 16, tok ? { tok: { ic: tok } } : {});
  const n1 = mk('rgb(1, 2, 3)'), n2 = mk('rgb(1, 2, 3)'), n3 = mk('rgb(255, 0, 0)'), n4 = mk('rgb(0, 255, 0)', 'c:00ff00@100');
  const r = collectIcons([file(n1, n2, n3, n4)], { tokens: { colors: [{ key: 'c:ff0000@100', role: 'icon', status: 'create' }] } });
  assert.equal(r.icons[0].dominantColor, 'c:010203@100');
  assert.equal(n1.cmp.c, undefined);
  assert.equal(n3.cmp.c, 'c:ff0000@100');
  assert.equal(n4.cmp.c, 'c:00ff00@100');
  const n5 = mk('rgb(255, 0, 0)');
  collectIcons([file(mk('rgb(1, 2, 3)'), mk('rgb(1, 2, 3)'), n5)], { isLiveToken: (k) => k === 'c:ff0000@100' });
  assert.equal(n5.cmp.c, 'c:ff0000@100');
});

test('tolerance merges sub-pixel noise, but not real differences', () => {
  const noisy = node(svg('<path d="M9.04 18l5.96-6.03-6.01-5.97"/>'), 16);
  const clean = node(svg(`<path d="${CHEV}"/>`), 16), clean2 = node(svg(`<path d="${CHEV}"/>`), 16);
  const other = node(svg('<path d="M9 18l6-6-6-5"/>'), 16);
  const r = collectIcons([file(clean, clean2, noisy, other)]);
  assert.equal(r.icons.length, 2);
  assert.equal(r.stats.mergedByTolerance, 1);
  assert.equal(noisy.cmp.id, clean.cmp.id);
  assert.notEqual(other.cmp.id, clean.cmp.id);
  assert.equal(collectIcons([file(node(svg(`<path d="${CHEV}"/>`)), node(svg('<path d="M9.04 18l5.96-6.03-6.01-5.97"/>')))], { tol: 0 }).icons.length, 2);
  assert.equal(maxDev([1, 2], [1, 2, 3]), Infinity);
  assert.equal(clusterSigs([]).length, 0);
});

test('guard: illustrations, charts, logos and big svgs are reported, not made into icons', () => {
  const big = node(svg(`<path d="${PLUS}"/>`, { size: 120 }), 120);
  const wide = node(svg(`<path d="${PLUS}"/>`), 80); wide.h = 10; wide.w = 60;
  const txt = node(svg('<path d="M0 0h10"/><text>12</text>'), 16);
  const grad = node('<svg width="24" height="24" viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h24v24z"/></svg>', 24);
  const dot = node(svg('<circle cx="12" cy="12" r="4"/>'), 3);
  const many = node(svg(Array.from({ length: 20 }, (_, i) => `<path d="M${i} 0h2"/>`).join('')), 24);
  const bad = node('garbage', 16), empty = node(svg(''), 16);
  const ok = node(svg(`<path d="${PLUS}"/>`), 16);
  const r = collectIcons([file(big, wide, txt, grad, dot, many, bad, empty, ok)]);
  assert.equal(r.icons.length, 1);
  assert.equal(ok.cmp.kind, 'icon');
  for (const n of [big, wide, txt, grad, dot, many, bad, empty]) assert.equal(n.cmp, undefined);
  const br = r.stats.decorativeByReason;
  assert.deepEqual(Object.keys(br).sort(), ['aspect', 'complex', 'empty', 'gradient', 'invalid', 'size', 'text', 'tiny']);
  assert.equal(r.stats.decorativeNodes, 8);
  assert.equal(r.decorative.length, 8);
  assert.equal(collectIcons([file(node(svg(`<path d="${PLUS}"/>`)))], { minUses: 2 }).icons.length, 0);
});

test('names: table hook, hints, collisions', () => {
  const table = { 'chevron-right': svg(`<path d="${CHEV}"/>`), plus: svg(`<path d="${PLUS}"/>`, { vb: '0 0 16 16' }) };
  assert.equal(buildNameTable(table).size, 2);
  assert.equal(buildNameTable([{ name: 'x', svg: svg(`<path d="${PLUS}"/>`) }]).get(iconSig(svg(`<path d="${PLUS}"/>`)).shape), 'x');
  const a = node(svg(`<path d="${CHEV}"/>`)), b = node(svg(`<path d="${PLUS}"/>`)), s = node(svg(SEARCH));
  const r = collectIcons([file(a, b, s)], { nameTable: { 'chevron-right': svg(`<path d="${CHEV}"/>`) } });
  assert.equal(r.icons.find((i) => i.id === a.cmp.id).name, 'chevron-right');
  assert.equal(r.stats.names.table, 1);
  assert.equal(r.stats.names.hash, 2);
  // hints: aria-label on the root agreed by >= 50% of the cluster
  const lab = (l) => node(svg(`<path d="${PLUS}"/>`).replace('<svg ', `<svg aria-label="${l}" `));
  const r2 = collectIcons([file(lab('Add'), lab('Add'), lab('Other'))]);
  assert.equal(r2.icons[0].name, 'Icon / Add');
  assert.equal(collectIcons([file(lab('A'), lab('B'), lab('C'))]).icons[0].name.startsWith('Icon / A'), false);
  assert.equal(collectIcons([file(lab('Add'))], { hints: false }).stats.names.hash, 1);
  // same shape, different stroke width -> two icons, unique names via the table
  const w15 = node(svg(`<path d="${CHEV}"/>`, { sw: 1.5 })), w2 = node(svg(`<path d="${CHEV}"/>`));
  const r3 = collectIcons([file(w2, w15)], { nameTable: table });
  assert.equal(r3.icons.length, 2);
  assert.equal(new Set(r3.icons.map((i) => i.name)).size, 2);
});

test('matchDsIcons: by geom when the inventory carries it, else by name', () => {
  const a = node(svg(`<path d="${CHEV}"/>`)), b = node(svg(`<path d="${PLUS}"/>`)), c = node(svg(SEARCH));
  const r = collectIcons([file(a, b, c)], { nameTable: { Plus: svg(`<path d="${PLUS}"/>`) } });
  const chev = r.icons.find((i) => i.id === a.cmp.id), plus = r.icons.find((i) => i.id === b.cmp.id);
  const m = matchDsIcons(r.icons, { icons: [{ id: '1:1', name: 'ChevronRight', geom: chev.geom }, { id: '1:2', name: 'plus' }, { id: '1:3', name: 'Zap' }] });
  assert.equal(m.stats.matched, 2);
  assert.deepEqual(chev.ds, { id: '1:1', name: 'ChevronRight' });
  assert.deepEqual(plus.ds, { id: '1:2', name: 'plus' });
  assert.equal(m.matched.find((x) => x.icon === plus.id).by, 'name');
  assert.equal(m.unmatched.length, 1); // the hash-named search icon never matches by name
  // a geom-carrying entry is never matched by name
  const r2 = collectIcons([file(node(svg(`<path d="${PLUS}"/>`)))], { nameTable: { Plus: svg(`<path d="${PLUS}"/>`) } });
  assert.equal(matchDsIcons(r2.icons, { icons: [{ id: 'x', name: 'Plus', geom: 'deadbeef00' }] }).stats.matched, 0);
  assert.equal(matchDsIcons(r2.icons, { icons: [{ id: 'x', name: 'Plus', geom: 'a' }, { id: 'y', name: 'Plus', geom: r2.icons[0].geom }, { id: 'z', name: 'P', geom: r2.icons[0].geom }] }, { mutate: false }).ambiguous.length, 1);
  assert.equal(matchDsIcons([], null).stats.matched, 0);
});

test('fixtures/ds: icons found in plain-sample agree with _library.json except the stand-in geom', (t) => {
  const plain = readFx('plain-sample.figma.json'), lib = readFx('_library.json'), tokens = readFx('tokens.json'), inv = readFx('ds-inventory.json');
  const nodes = [];
  (function w(n) { if (n.t === 'svg') nodes.push(n); (n.children || []).forEach(w); })({ children: plain.frames });
  const r = collectIcons([plain], { tokens });
  assert.equal(r.stats.svgNodes, nodes.length);
  assert.equal(r.icons.length, lib.icons.length);
  assert.equal(r.stats.decorativeNodes, 0);
  const diffs = [];
  for (const L of lib.icons) {
    const mine = r.icons.find((i) => i.geom === iconSig(L.svg).geom);
    assert.ok(mine, `fixture icon ${L.name} not found by iconSig(svg)`);
    assert.equal(mine.kind, L.kind);
    assert.equal(mine.strokeWidth, L.strokeWidth);
    assert.deepEqual(mine.vb, L.vb);
    assert.deepEqual(mine.sizes, L.sizes);
    assert.deepEqual(mine.vecPaths, L.vecPaths);
    assert.equal(mine.dominantColor, L.dominantColor);
    assert.equal(iconSig(mine.svg).geom, mine.geom);
    if (mine.id !== L.id) diffs.push(`${L.name}: ${L.id} -> ${mine.id}`);
  }
  // DS match: inventory geoms are stand-ins too, so geom matching finds nothing; name matching needs named icons
  const names = Object.fromEntries(lib.icons.map((L) => [L.name, L.svg]));
  const named = collectIcons([readFx('plain-sample.figma.json')], { tokens, nameTable: names });
  const m = matchDsIcons(named.icons, inv);
  assert.equal(m.stats.matched, 0, 'inventory geoms differ from iconSig, entries carrying geom are not matched by name');
  const m2 = matchDsIcons(named.icons, { icons: inv.icons.map(({ geom, ...e }) => e) });
  assert.deepEqual(m2.matched.map((x) => x.by), ['name', 'name']);
  assert.deepEqual(named.icons.filter((i) => i.ds).map((i) => i.name).sort(), ['Bell', 'User']);
  // cmp annotation shape
  assert.equal(nodes.filter((n) => n.cmp && n.cmp.kind === 'icon' && Array.isArray(n.cmp.sz)).length, nodes.length, 'every svg node annotated in place');
  t.diagnostic(`fixture stand-in geoms differ from iconSig (regenerate fixtures/ds): ${diffs.length}/${lib.icons.length}; fixture svg nodes carry cmp without sz`);
});

test('fixtures/ds enriched-sample: our cmp targets the same icon per node, adding sz', () => {
  const en = readFx('enriched-sample.figma.json'), lib = readFx('_library.json');
  const copy = JSON.parse(JSON.stringify(en));
  const r = collectIcons([copy], { tokens: readFx('tokens.json') });
  const byOldId = new Map(lib.icons.map((L) => [L.id, iconSig(L.svg).geom]));
  let n = 0;
  (function w(a, b) {
    if (a.t === 'svg') {
      n++;
      assert.equal(b.cmp.id, 'ic_' + byOldId.get(a.cmp.id));
      assert.equal(b.cmp.c, undefined); // fixtures write no cmp.c either
      assert.deepEqual(b.cmp.sz, [a.w, a.h]);
    }
    (a.children || []).forEach((k, i) => w(k, b.children[i]));
  })({ children: en.frames }, { children: copy.frames });
  assert.equal(n, 15);
  assert.equal(r.icons.length, 4);
});
