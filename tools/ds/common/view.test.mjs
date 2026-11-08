import test from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, stableName, makeView, screenViews, walkView, countNodes, nodeAt, formatPath, parsePath, locator, stripVolatile, INTERACTIVE_ROLES } from './view.mjs';

const C = (r, g, b, a = 1) => ({ r, g, b, a });
const tree = {
  t: 'frame', name: 'Screen / Default / 390', x: 0, y: 0, w: 390, h: 844, fill: C(1, 1, 1), ls: { k: 'V', s: ['F', 'F'], g: 12, p: [17, 16, 17, 16], bw: [1, 0, 1, 0] },
  children: [
    { t: 'frame', name: 'button · Save #1', x: 16, y: 20, w: 100, h: 44, fill: C(0, 0, 1, 0.5), radius: [8, 8, 8, 8], opacity: 0.5, shadow: [{ c: C(0, 0, 0, 0.2), x: 0, y: 4, blur: 8, spread: 0 }],
      ls: { k: 'H', s: ['H', 'H'], g: 8, p: [12, 16, 12, 16], bw: [0, 0, 0, 0] },
      children: [
        { t: 'svg', name: 'svg', x: 0, y: 0, w: 16, h: 16, svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(255, 255, 255)"><path d="M1 1"/></svg>', ls: { s: ['F', 'F'] } },
        { t: 'text', name: 'text', x: 0, y: 0, w: 30, h: 20, text: 'Save', font: { family: 'Inter', size: 14, weight: 500, lh: 20, ls: -0.28, color: C(1, 1, 1) }, runs: [{ s: 0, e: 2 }], ls: { s: ['H', 'H'], tx: { l: 2, lh: 20, tr: { l: 2 } } } },
      ] },
    { t: 'img', name: 'img', x: 0, y: 80, w: 50, h: 50, fit: 'FILL', data: 'data:image/png;base64,AAAA', fill: C(0, 0, 0) },
  ],
};

test('roleOf / stableName strip labels and ids', () => {
  assert.equal(roleOf('button · Save'), 'button');
  assert.equal(roleOf('div#day-8f69'), 'div');
  assert.equal(roleOf('Auth / Login / Default / 390'), 'frame');
  assert.equal(roleOf('text'), 'text');
  assert.equal(stableName('item · Notifications'), 'item');
  assert.equal(stableName('input#auth-identifier'), 'input');
  assert.equal(stableName('Auth / Login'), 'Auth / Login');
  assert.ok(INTERACTIVE_ROLES.has('button'));
});

test('makeView normalises a frame', () => {
  const v = makeView(tree, { file: 'f', screen: 'S', screenIdx: 2 });
  assert.equal(v.k, 'V'); assert.deepEqual(v.s, ['F', 'F']); assert.equal(v.g, 12);
  assert.deepEqual(v.pInner, [16, 16, 16, 16]);       // padding minus drawn stroke
  assert.equal(v.styled, true);
  assert.equal(v.kids.length, 2);
  assert.equal(locator(v.kids[0]), 'f/S#2/0');
  const b = v.kids[0];
  assert.equal(b.role, 'button'); assert.equal(b.name, 'button');
  assert.deepEqual(b.radius, [8, 8, 8, 8]);
  assert.equal(b.opacity, 0.5);
  assert.equal(b.shadows.length, 1);
  assert.deepEqual(b.paints.map((p) => p.role), ['fill', 'shadow']);
});

test('text, svg, img specs', () => {
  const b = makeView(tree).kids[0];
  const [svg, txt] = b.kids;
  assert.equal(svg.svg.colours[0].attr, 'stroke');
  assert.equal(svg.paints[0].role, 'icon');
  assert.equal(txt.text.multi, true); assert.equal(txt.text.trunc, true); assert.equal(txt.text.hasRuns, true);
  assert.equal(txt.text.size, 14);
  assert.equal(txt.paints[0].role, 'text');
  const img = makeView(tree).kids[1];
  assert.equal(img.img.fit, 'FILL');
});

test('token keys in tok become paint keys', () => {
  const n = { ...tree.children[0], tok: { f: 'c:0000ff@50' }, children: [] };
  assert.equal(makeView(n).paints[0].key, 'c:0000ff@50');
  assert.match(makeView(tree.children[0]).paints[0].key, /^q:/);
});

test('collapse turns nodes with cmp into leaf instances', () => {
  const t2 = JSON.parse(JSON.stringify(tree)); t2.children[0].cmp = { id: 'cmp_button_ab12', v: { Type: 'Primary' } };
  const v = makeView(t2, { collapse: true });
  assert.equal(v.kids[0].inst.id, 'cmp_button_ab12');
  assert.equal(v.kids[0].kids.length, 0);
  assert.equal(countNodes(v), 3);
  assert.equal(countNodes(makeView(t2)), 5);
});

test('walk, paths, nodeAt, screenViews', () => {
  const v = makeView(tree);
  const seen = []; walkView(v, (x) => { seen.push(x.t); });
  assert.deepEqual(seen, ['frame', 'frame', 'svg', 'text', 'img']);
  const skipped = []; walkView(v, (x) => { skipped.push(x.t); return x.role !== 'button'; });
  assert.equal(skipped.length, 3);
  assert.equal(nodeAt(tree, [0, 1]).text, 'Save');
  assert.equal(nodeAt(tree, [5]), null);
  assert.equal(formatPath([0, 1]), '0/1'); assert.deepEqual(parsePath('0/1'), [0, 1]); assert.deepEqual(parsePath(''), []);
  assert.equal(screenViews({ frames: [tree, tree] }, { file: 'x' })[1].screenIdx, 1);
});

test('stripVolatile removes labels, ids, positions and text', () => {
  const a = stripVolatile(tree);
  const t2 = JSON.parse(JSON.stringify(tree));
  t2.children[0].name = 'button · Cancel #77'; t2.children[0].x = 99; t2.children[0].children[1].text = 'Cancel';
  t2.children[0].children[0].svg = t2.children[0].children[0].svg.replace('M1 1', 'M2 2');
  assert.deepEqual(stripVolatile(t2), a);
  assert.equal(a.children[0].name, 'button');
  assert.equal('data' in a.children[1], false);
});
