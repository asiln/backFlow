import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, assertValid, SCHEMAS, loadSchema } from './validate.mjs';
import { textStyleKey, parseTextStyleKey, radiusKey, spacingKey, effectKey, keyNumber } from './keys.mjs';

const fx = (f) => JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/ds', f), 'utf8'));
const ok = (name, data) => { const r = validate(name, data); assert.ok(r.ok, JSON.stringify(r.errors.slice(0, 3))); };
const bad = (name, data, re) => { const r = validate(name, data); assert.ok(!r.ok, 'expected failure'); if (re) assert.match(JSON.stringify(r.errors), re); };

test('every schema file loads', () => { for (const k of Object.keys(SCHEMAS)) assert.ok(loadSchema(k).$schema); });

test('keyword engine basics', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 1 }, b: { enum: ['x', 'y'] }, c: { type: 'array', items: { type: 'string' }, minItems: 1 } }, additionalProperties: false };
  assert.ok(validate(s, { a: 1, b: 'x', c: ['q'] }).ok);
  assert.ok(!validate(s, { a: 0 }).ok);
  assert.ok(!validate(s, { a: 1.5 }).ok);
  assert.ok(!validate(s, {}).ok);
  assert.ok(!validate(s, { a: 1, z: 1 }).ok);
  assert.ok(!validate(s, { a: 1, c: [] }).ok);
  assert.ok(validate({ oneOf: [{ type: 'string' }, { type: 'number' }] }, 1).ok);
  assert.ok(!validate({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1).ok); // matches both
  assert.ok(validate({ if: { required: ['k'] }, then: { required: ['v'] } }, { z: 1 }).ok);
  assert.ok(!validate({ if: { required: ['k'] }, then: { required: ['v'] } }, { k: 1 }).ok);
  assert.ok(validate({ type: 'string', pattern: '^a' }, 'abc').ok);
  assert.ok(validate({ prefixItems: [{ type: 'number' }, { type: 'null' }] }, [1, null]).ok);
});

test('fixtures validate', () => {
  ok('screen-file', fx('plain-sample.figma.json'));
  ok('screen-file', fx('enriched-sample.figma.json'));
  ok('library', fx('_library.json'));
  ok('tokens', fx('tokens.json'));
  ok('config', fx('ds.config.json'));
  ok('inventory', fx('ds-inventory.json'));
  ok('decisions', fx('component-decisions.json'));
  assertValid('library', fx('_library.json'));
});

test('legacy node without ls/cmp/tok and with a future field passes', () => {
  ok('node', { t: 'frame', name: 'x', x: 0, y: 0, w: 1, h: 1, futureField: { a: 1 } });
  ok('screen-file', { figmaLift: 1, frames: [{ t: 'frame', name: 'x', x: 0, y: 0, w: 1, h: 1 }] });
  bad('screen-file', { frames: [] });
  bad('node', { t: 'blob', name: 'x', x: 0, y: 0, w: 1, h: 1 });
});

test('cmp: variants of Override', () => {
  ok('cmp', { id: 'cmp_btn_3fa2', v: { Type: 'Primary' }, ov: [{ s: '0', t: 'Hi' }, { s: '1', b: false }, { s: '2', ic: 'ic_ab', c: 'c:ffffff@100', sz: 16 }, { s: '3', img: { fit: 'FILL' } }, { s: '4', fill: { r: 0, g: 0, b: 0 } }, { s: '2.1', v: { State: 'Disabled' } }], dev: 0.4, conf: 87 });
  ok('cmp', { id: 'ic_ab12', kind: 'icon', c: 'c:000000@100' });
  bad('cmp', { v: {} }, /id/);
  bad('cmp', { id: 'btn' });
  bad('cmp', { id: 'cmp_x', ov: [{ s: 'a', t: 'x' }] });
  bad('cmp', { id: 'cmp_x', ov: [{ s: '0' }] });          // no payload
  bad('cmp', { id: 'cmp_x', ov: [{ s: '0', t: 'x', b: true }] }); // ambiguous
  bad('cmp', { id: 'cmp_x', conf: 120 });
});

test('tok key formats', () => {
  ok('tok', { f: 'c:191d24@100', tx: 'c:ffffff@100', ts: 't:Inter/14/500/20/0', r: 'r:16', g: 'sp:12', p: ['sp:8', null, 'sp:8', null], e: 'e:0,0,16,0,8150e7@25' });
  bad('tok', { f: '#191d24' });
  bad('tok', { r: '16' });
  bad('tok', { p: ['sp:8'] });
  bad('tok', { nope: 1 });
});

test('tokens / library / config / decisions reject malformed data', () => {
  const t = fx('tokens.json'); t.colors[0].status = 'maybe';
  bad('tokens', t, /one of/);
  const t2 = fx('tokens.json'); delete t2.colors.find((c) => c.status === 'bound').target;
  bad('tokens', t2, /target/);
  const l = fx('_library.json'); l.components[0].band = 'report-only';
  bad('library', l);
  const l2 = fx('_library.json'); l2.components[0].slots[0].kind = 'weird';
  bad('library', l2);
  bad('config', { dsMode: 'sometimes' });
  bad('config', { thresholds: { occ: 0 } });
  ok('config', { 'x-note': 1, dsMode: 'report' });
  bad('decisions', { version: 1, decisions: [{ action: 'accept' }] });                    // no id/sig
  bad('decisions', { version: 1, decisions: [{ id: 'cmp_a', action: 'rename' }] });       // rename needs name
  ok('decisions', { version: 1, decisions: [{ id: 'cmp_a', action: 'merge', into: 'cmp_b' }] });
  bad('inventory', { file: 'x' });
});

test('key helpers', () => {
  const f = { family: 'Inter', size: 11, weight: 700, lh: 13.75, ls: 0.275 };
  assert.equal(textStyleKey(f), 't:Inter/11/700/13.75/0.025');
  assert.deepEqual(parseTextStyleKey('t:Inter/11/700/13.75/0.025'), { family: 'Inter', size: 11, weight: 700, lh: 13.75, lsEm: 0.025 });
  assert.equal(radiusKey([16, 16, 16, 16]), 'r:16');
  assert.equal(radiusKey([16, 16, 0, 0]), 'r:16/16/0/0');
  assert.equal(radiusKey(0), null);
  assert.equal(spacingKey(12), 'sp:12');
  assert.equal(effectKey([{ x: 0, y: 0, blur: 16, spread: 0, c: { r: 0.5059, g: 0.3137, b: 0.9059, a: 0.25 } }]), 'e:0,0,16,0,8150e7@25');
  assert.equal(effectKey([{ inset: true, x: 0, y: 1, blur: 0, spread: 0, c: { r: 1, g: 1, b: 1, a: 1 } }, { x: 0, y: 4, blur: 8, spread: 0, c: { r: 0, g: 0, b: 0, a: 0.2 } }]), 'e:i0,1,0,0,ffffff@100|0,4,8,0,000000@20');
  assert.equal(keyNumber('sp:12'), 12);
  assert.equal(keyNumber('r:16/16/0/0'), 16);
});
