import test from 'node:test';
import assert from 'node:assert/strict';
import { iconSig, parsePath, parseXml, canonicalSvg } from './sig.mjs';

const wrap = (inner, { vb = '0 0 24 24', size = 24, stroke = 'rgb(1, 2, 3)', sw = 2, extra = '' } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${extra}>${inner}</svg>`;
const plus = wrap('<path d="M5 12h14"/><path d="M12 5v14"/>');

test('ignores colour, size, ids, attribute order and element order', () => {
  const a = iconSig(plus);
  const b = iconSig('<svg id="x" stroke-linejoin="round" stroke-linecap="round" stroke-width="2" stroke="#ff0000" fill="none" viewBox="0 0 24 24" height="14" width="14"><path id="q" d="M12 5v14"/><path d="M5 12h14"/></svg>');
  assert.equal(a.geom, b.geom);
  assert.equal(a.kind, 'stroke');
  assert.equal(a.strokeWidth, 2);
  assert.deepEqual(b.size, [14, 14]);
  assert.equal(a.colorKey, 'c:010203@100');
});

test('path syntax: relative/absolute, H/V, implicit commands, number forms, packed arc flags, one vs many paths', () => {
  const g = (d) => iconSig(wrap(`<path d="${d}"/>`)).geom;
  assert.equal(g('M5 12h14M12 5v14'), g('M 5,12 L 19,12 M12,5 V19'));
  assert.equal(g('M5 12h14M12 5v14'), g('m5 12 14 0m-7-7 0 14'));
  assert.equal(g('M5.0 12.00h14M12 5v14'), g('M5 12h14M12 5v14'));
  assert.equal(g('M.5 .5L1.50 .5'), g('M0.5 0.5 1.5 0.5'));
  assert.equal(g('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0'), g('M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0'));
  assert.equal(g('M1 1L9 1L9 9L1 1Z'), g('M1 1L9 1L9 9Z'));
  assert.equal(g('M2 2C4 2 6 4 6 6S8 10 10 10'), g('M2 2C4 2 6 4 6 6C6 8 8 10 10 10'));
  assert.equal(parsePath('M0 0 1 1 2 2').length, 3);
  assert.deepEqual(parsePath('M0 0a1 1 0 00.5.5').map((s) => s.c), ['M', 'A']);
  assert.deepEqual(parsePath('M1 1h2z l1 1').map((s) => s.c), ['M', 'L', 'Z', 'M', 'L']);
  assert.deepEqual(parsePath('garbage'), []);
});

test('shape elements equal their path form', () => {
  const line = iconSig(wrap('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 12 19"/>'));
  assert.equal(line.geom, iconSig(plus).geom);
  const rect = iconSig(wrap('<rect x="3" y="3" width="18" height="18"/>')).geom;
  assert.equal(rect, iconSig(wrap('<path d="M3 3H21V21H3Z"/>')).geom);
  const circ = iconSig(wrap('<circle cx="12" cy="12" r="5"/>')).geom;
  assert.equal(circ, iconSig(wrap('<ellipse cx="12" cy="12" rx="5" ry="5"/>')).geom);
  assert.notEqual(circ, iconSig(wrap('<circle cx="12" cy="12" r="6"/>')).geom);
});

test('viewBox scaling and root size do not matter', () => {
  const a = iconSig(plus);
  const b = iconSig(wrap('<path d="M3.3333 8h9.3333"/><path d="M8 3.3333v9.3333"/>', { vb: '0 0 16 16', size: 12, sw: 1.3333 }));
  assert.equal(a.geom, b.geom);
  assert.deepEqual(b.vb, [0, 0, 16, 16]);
  const c = iconSig(wrap('<path d="M105 12h14"/><path d="M112 5v14"/>', { vb: '100 0 24 24' }));
  assert.equal(a.geom, c.geom);
  const d = iconSig(plus.replace(' viewBox="0 0 24 24"', ''));
  assert.equal(a.geom, d.geom);
});

test('transforms on g/elements are baked', () => {
  const a = iconSig(wrap('<g transform="translate(0 0)"><path d="M5 12h14"/></g><path d="M12 5v14"/>'));
  assert.equal(a.geom, iconSig(plus).geom);
  const b = iconSig(wrap('<g transform="translate(2 3)"><path d="M3 9h14"/></g>'));
  assert.equal(b.geom, iconSig(wrap('<path d="M5 12h14"/>')).geom);
  const r = iconSig(wrap('<path transform="rotate(90 12 12)" d="M5 12h14"/>'));
  assert.equal(r.geom, iconSig(wrap('<path d="M12 5v14"/>')).geom);
  const arc = iconSig(wrap('<path transform="rotate(90 12 12)" d="M4 12a8 8 0 0 1 16 0"/>'));
  assert.ok(arc.nums.length > 0);
});

test('style that matters changes geom, shape stays', () => {
  const a = iconSig(plus), w = iconSig(wrap('<path d="M5 12h14"/><path d="M12 5v14"/>', { sw: 1.5 }));
  assert.notEqual(a.geom, w.geom);
  assert.equal(a.shape, w.shape);
  const f = iconSig('<svg viewBox="0 0 24 24" width="24" height="24" fill="rgb(0, 0, 0)" stroke="none"><path d="M5 12h14"/><path d="M12 5v14"/></svg>');
  assert.equal(f.kind, 'fill');
  assert.equal(f.strokeWidth, undefined);
  assert.equal(f.shape, a.shape);
  assert.notEqual(f.geom, a.geom);
  const butt = iconSig(plus.replace('stroke-linecap="round"', 'stroke-linecap="butt"'));
  assert.notEqual(a.geom, butt.geom);
});

test('walker output forms: explicit defaults, gradients, defs, filters, text, currentColor', () => {
  const full = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(126, 133, 145)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="4" stroke-dasharray="none" stroke-dashoffset="0" stroke-opacity="1" fill-opacity="1" fill-rule="nonzero" clip-rule="nonzero" font-family="X" font-size="14" font-weight="700" text-anchor="start">${inner}</svg>`;
  const a = iconSig(full('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'));
  assert.equal(a.kind, 'stroke');
  assert.equal(a.info.dashed, false);
  assert.equal(a.colorKey, 'c:7e8591@100');
  const g = iconSig(full('<defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><path fill="url(#g)" d="M0 0h10v10z"/>'));
  assert.ok(g.info.gradient);
  assert.equal(g.info.elements, 1);
  assert.ok(iconSig(full('<path filter="url(#f)" d="M0 0h10"/>')).info.filter);
  assert.ok(iconSig(full('<text>hi</text>')).info.text);
  const cc = iconSig('<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" color="rgb(10, 20, 30)"><path d="M0 0h10v10z"/></svg>');
  assert.equal(cc.colorKey, 'c:0a141e@100');
  const op = iconSig(full('<path opacity="0.5" d="M0 0h10"/>'));
  assert.equal(op.colorKey, 'c:7e8591@50');
  assert.equal(iconSig('<svg><path d="M0 0"/></svg>').info.subpaths, 0);
});

test('two-style icons keep both groups; hidden elements are ignored; invalid input is safe', () => {
  const two = iconSig(wrap('<path d="M5 12h14"/><path opacity="0.4" d="M12 5v14"/>'));
  assert.notEqual(two.geom, iconSig(plus).geom);
  const hid = iconSig(wrap('<path d="M5 12h14"/><path d="M12 5v14"/><path display="none" d="M0 0h24"/>'));
  assert.equal(hid.geom, iconSig(plus).geom);
  assert.ok(iconSig('not svg').info.parseError);
  assert.ok(iconSig('').info.parseError);
  assert.equal(parseXml('<svg><g/></svg>').children.length, 1);
});

test('canonicalSvg re-signs to the same geom and drops colours', () => {
  const a = iconSig(plus.replace('width="24" height="24"', 'width="16" height="16"'));
  const s = canonicalSvg(a);
  assert.match(s, /^<svg /);
  assert.ok(!/rgb\(/.test(s));
  assert.equal(iconSig(s).geom, a.geom);
  const u = iconSig(wrap('<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>', { vb: '0 0 16 16', size: 20, sw: 1.5 }));
  assert.equal(iconSig(canonicalSvg(u)).geom, u.geom);
  const f = iconSig('<svg viewBox="0 0 24 24" width="24" height="24" fill="#000"><path d="M0 0h10v10z"/></svg>');
  assert.equal(iconSig(canonicalSvg(f)).geom, f.geom);
});
