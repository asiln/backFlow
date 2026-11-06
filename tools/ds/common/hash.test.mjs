import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, hashStr, hashJson, q, q2, qEm, tolOf, quantise, slotsClose, slotsDistance, paintsClose, digestView, componentId, ownSlots } from './hash.mjs';
import { makeView } from './view.mjs';

const C = (r, g, b, a = 1) => ({ r, g, b, a });
const text = (s, size = 14, color = C(0, 0, 0)) => ({ t: 'text', name: 'text', x: 0, y: 0, w: 40, h: 20, text: s, font: { family: 'Inter', size, weight: 500, lh: 20, ls: 0, color }, ls: { s: ['H', 'H'], tx: { l: 1, lh: 20 } } });
const btn = (label, { fill = C(0.2, 0.4, 0.9), w = 80, g = 8, pad = 12, radius = 8 } = {}) => ({
  t: 'frame', name: `button · ${label}`, x: 5, y: 7, w, h: 44, fill, radius,
  ls: { k: 'H', s: ['H', 'H'], g, g2: 0, p: [pad, 16, pad, 16], bw: [0, 0, 0, 0] }, children: [text(label)],
});
const D = (n, opts) => digestView(makeView(n, {}), opts);

test('canonicalJson sorts keys and is stable', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(canonicalJson(-0), '0');
  assert.equal(canonicalJson(NaN), 'null');
  assert.equal(hashJson({ a: 1, b: 2 }), hashJson({ b: 2, a: 1 }));
  assert.equal(hashStr('x').length, 10);
  assert.equal(hashStr('x', 40).length, 40);
  assert.notEqual(hashStr('x'), hashStr('y'));
});

test('quantisers and tolerances (spec 1.2 / 1.4)', () => {
  assert.equal(q(8.4), 8); assert.equal(q(8.5), 9);
  assert.equal(q2(9), 10); assert.equal(q2(8.9), 8);
  assert.equal(qEm(0.025), 0.02);
  assert.equal(tolOf('gap', 8, 9), 1);
  assert.equal(tolOf('size', 100, 100), 2);
  assert.equal(tolOf('size', 1000, 1000), 20); // 2% wins above 100px
  assert.equal(tolOf('font', 11, 12), 0);
  assert.equal(quantise('size', 359), 360);
});

test('slot vectors: 9 vs 10 merges, 8 vs 10 does not', () => {
  const mk = (v) => [{ c: 'radius', v }, { c: 'font', v: 12 }];
  assert.ok(slotsClose(mk(9), mk(10)));
  assert.ok(!slotsClose(mk(8), mk(10)));
  assert.equal(slotsDistance(mk(9), mk(10)).dev, 1);
  assert.ok(!slotsClose(mk(9), [{ c: 'radius', v: 9 }, { c: 'font', v: 11 }])); // font size exact
  assert.ok(!slotsClose(mk(9), [{ c: 'radius', v: 9 }]));
});

test('S ignores label text, ids, positions, colours and free-axis widths', () => {
  const a = D(btn('Save'));
  const b = D(btn('Cancel an operation', { w: 200, fill: C(0.9, 0.9, 0.9) }));
  assert.equal(a.S, b.S);
  assert.notEqual(a.P, b.P);              // colours differ
  assert.equal(a.M, D(btn('Other', { w: 300 })).M); // hug width is not in M
});

test('M reacts to metrics, P to paints, S to structure', () => {
  const base = D(btn('A'));
  assert.notEqual(base.M, D(btn('A', { g: 12 })).M);
  assert.notEqual(base.M, D(btn('A', { radius: 12 })).M);
  assert.equal(base.S, D(btn('A', { g: 12 })).S);
  const withIcon = btn('A'); withIcon.children.unshift({ t: 'svg', name: 'svg', x: 0, y: 0, w: 16, h: 16, svg: '<svg width="16" height="16" stroke="rgb(0, 0, 0)"><path d="M0 0"/></svg>', ls: { s: ['F', 'F'] } });
  assert.notEqual(base.S, D(withIcon).S);
  assert.equal(D(withIcon).leaves, 2);
  assert.equal(D(withIcon).nodes, 3);
});

test('paints: token key beats raw colour, alpha is quantised to 0.02', () => {
  const x = btn('A', { fill: C(0.2, 0.4, 0.9, 0.5) });
  const y = btn('A', { fill: C(0.2, 0.4, 0.9, 0.505) });
  assert.equal(D(x).P, D(y).P);
  const tx = { ...btn('A'), tok: { f: 'c:3366e6@100' } };
  const ty = { ...btn('A', { fill: C(0.21, 0.4, 0.9) }), tok: { f: 'c:3366e6@100' } };
  assert.equal(D(tx).P, D(ty).P); // same token key although raw colour differs slightly
  assert.ok(paintsClose(D(btn('A')).paints, D(btn('A', { fill: C(0.2, 0.402, 0.9) })).paints));
  assert.ok(!paintsClose(D(btn('A')).paints, D(btn('A', { fill: C(0.9, 0.2, 0.2) })).paints));
});

test('nested instances are variant-agnostic leaves for S, visible in P', () => {
  const card = (v) => ({ t: 'frame', name: 'article', x: 0, y: 0, w: 300, h: 100, fill: C(1, 1, 1), ls: { k: 'V', s: ['L', 'H'], g: 8, p: [16, 16, 16, 16], bw: [0, 0, 0, 0] },
    children: [text('Title'), { ...btn('Go'), cmp: { id: 'cmp_button_ab12', v } }] });
  const dv = (n) => digestView(makeView(n, { collapse: true }));
  const a = dv(card({ Type: 'Primary' })), b = dv(card({ Type: 'Secondary' }));
  assert.equal(a.S, b.S);
  assert.notEqual(a.P, b.P);
  assert.equal(a.nodes, 3);
  // without collapse the nested button is expanded
  assert.equal(digestView(makeView(card({ Type: 'Primary' }))).nodes, 4);
});

test('ignoreRootSizing drops only the root ls.s pair', () => {
  const a = btn('A'), b = btn('A'); b.ls = { ...b.ls, s: ['L', 'H'] };
  assert.notEqual(D(a).S, D(b).S);
  assert.equal(D(a, { ignoreRootSizing: true }).S, D(b, { ignoreRootSizing: true }).S);
});

test('ownSlots: free axes are not part of the metric vector', () => {
  const hug = ownSlots(makeView(btn('A')));
  const fixed = btn('A'); fixed.ls = { ...fixed.ls, s: ['F', 'F'] };
  assert.equal(ownSlots(makeView(fixed)).length, hug.length + 2);
});

test('componentId', () => {
  assert.match(componentId('List Item', 'abc'), /^cmp_list-item_[0-9a-f]{4}$/);
  assert.equal(componentId('Button', 'S1'), componentId('button', 'S1'));
});
