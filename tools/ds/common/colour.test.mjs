import test from 'node:test';
import assert from 'node:assert/strict';
import { toRgba, rgbaToHex, hex6, hexToRgba, colourKey, parseColourKey, isColourKey, quantKey, quantAlpha, deltaE76, deltaE2000, deltaE2000Lab, coloursClose, compositeOver, parseCssColour } from './colour.mjs';

test('hex and key round trip', () => {
  const c = { r: 0.0980, g: 0.1137, b: 0.1412, a: 1 }; // #191D24
  assert.equal(rgbaToHex(c), '#191D24');
  assert.equal(hex6(c), '191d24');
  assert.equal(colourKey(c), 'c:191d24@100');
  assert.equal(colourKey({ ...hexToRgba('#8150e7'), a: 0.25 }), 'c:8150e7@25');
  const p = parseColourKey('c:8150e7@25');
  assert.equal(p.hex, '#8150E7');
  assert.equal(p.a, 0.25);
  assert.ok(isColourKey('c:000000@0'));
  assert.ok(!isColourKey('c:000000'));
  assert.throws(() => parseColourKey('x'));
});

test('toRgba accepts strings, keys and objects', () => {
  assert.deepEqual(rgbaToHex(toRgba('#fff')), '#FFFFFF');
  assert.equal(toRgba('#00000080').a.toFixed(2), '0.50');
  assert.equal(rgbaToHex(toRgba('c:2f6fed@50')), '#2F6FED');
  assert.equal(toRgba({ r: 1, g: 0, b: 0 }).a, 1);
});

test('alpha handling: rounding to percent and quantisation grid', () => {
  assert.equal(colourKey({ r: 0, g: 0, b: 0, a: 0.255 }), 'c:000000@26');
  assert.equal(quantAlpha(0.51), 0.52);
  assert.equal(quantKey({ r: 1, g: 1, b: 1, a: 0.5 }), 'q:ffffff@50');
  assert.equal(quantKey({ r: 1, g: 1, b: 1, a: 0.505 }), quantKey({ r: 1, g: 1, b: 1, a: 0.49 }));
});

test('deltaE76 reference values', () => {
  assert.equal(deltaE76('#000000', '#000000'), 0);
  assert.ok(Math.abs(deltaE76('#ffffff', '#000000') - 100) < 0.01);
  // white vs one level off is imperceptible
  assert.ok(deltaE76('#ffffff', '#fefefe') < 1);
  assert.ok(deltaE76('#ff0000', '#00ff00') > 100);
});

test('deltaE2000 matches Sharma et al. reference pairs', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  assert.ok(near(deltaE2000Lab({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }), 2.0425));
  assert.ok(near(deltaE2000Lab({ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }), 2.8615));
  assert.ok(near(deltaE2000Lab({ L: 50, a: 2.5, b: 0 }, { L: 50, a: 0, b: -2.5 }), 4.3065));
  assert.equal(deltaE2000('#336699', '#336699'), 0);
  const a = '#2f6fed', b = '#3a78f0';
  assert.ok(Math.abs(deltaE2000(a, b) - deltaE2000(b, a)) < 1e-9);
  assert.ok(deltaE2000(a, b) <= deltaE76(a, b) + 1e-9);
});

test('coloursClose follows spec 1.4 tolerance (dE 1.5, alpha 0.02)', () => {
  assert.ok(coloursClose('#191d24', '#191d24'));
  assert.ok(coloursClose('#191d24', '#1a1d24')); // 1 level off
  assert.ok(!coloursClose('#191d24', '#2f6fed'));
  assert.ok(coloursClose({ r: 1, g: 0, b: 0, a: 0.5 }, { r: 1, g: 0, b: 0, a: 0.51 }));
  assert.ok(!coloursClose({ r: 1, g: 0, b: 0, a: 0.5 }, { r: 1, g: 0, b: 0, a: 0.6 }));
  assert.ok(coloursClose('c:8150e7@25', 'c:8150e7@25'));
  assert.ok(!coloursClose('#000000', '#101010', { deltaE: 1.5 }));
  assert.ok(coloursClose('#000000', '#101010', { deltaE: 10 }));
  assert.ok(coloursClose('#2f6fed', '#2f6fee', { metric: '2000' }));
});

test('compositeOver and parseCssColour', () => {
  const c = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 1, g: 1, b: 1, a: 1 });
  assert.equal(Math.round(c.r * 100) / 100, 0.5);
  assert.equal(c.a, 1);
  assert.deepEqual(rgbaToHex(parseCssColour('rgb(47, 111, 237)')), '#2F6FED');
  assert.equal(parseCssColour('rgba(0, 0, 0, 0.4)').a, 0.4);
  assert.equal(parseCssColour('none'), null);
  assert.equal(parseCssColour('#abc').r, 0xaa / 255);
});
