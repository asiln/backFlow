// Regression tests for plugin/code.js (import plugin) against the mocked Figma API in plugin-mock.mjs.
// The mock is NOT Figma; these tests guard the logic: instance ladder, overrides, registry, slot tables, token binding, inertness without cmp/tok.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENRICHED = 'fixtures/ds/enriched-sample.figma.json';
const PLAIN = 'fixtures/ds/plain-sample.figma.json';
function run(file, ...flags) {
  const r = spawnSync(process.execPath, ['plugin-mock.mjs', file, ...flags], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = r.stdout;
  const m = /Design system: instances (\d+) \(R0 (\d+), R1 (\d+), detached (\d+)\), icons (\d+), plain-frame fallbacks (\d+) \(missing master (\d+), left plain by tool (\d+)\), override failures (\d+), token bindings (\d+) \(no match (\d+)\)/.exec(out);
  const ds = m && { inst: +m[1], r0: +m[2], r1: +m[3], detached: +m[4], icons: +m[5], plain: +m[6], missing: +m[7], rejected: +m[8], ovFail: +m[9], tokBound: +m[10], tokMiss: +m[11] };
  return { out, ds };
}

test('plain export is untouched by the design-system code (no cmp/tok fields)', () => {
  const { out, ds } = run(PLAIN, '--quiet');
  assert.equal(ds, null);
  assert.match(out, /mock violations: none/);
});

test('enriched export: instances of the masters, every override applied, tokens bound', () => {
  const { ds, out } = run(ENRICHED, '--ds');
  assert.ok(ds, out);
  assert.ok(ds.inst >= 10, 'instances ' + ds.inst);
  assert.equal(ds.ovFail, 0, 'override failures');
  assert.equal(ds.missing, 0);
  assert.ok(ds.tokBound >= 40, 'token bindings ' + ds.tokBound);
  assert.equal(ds.tokMiss, 0);
  assert.match(out, /No failures\./);
});

test('missing masters fall back to plain frames, never abort', () => {
  const { ds, out } = run(ENRICHED, '--ds', '--drop=cmp_button_8ff3');
  assert.ok(ds.missing > 0, 'missing master counted');
  assert.match(out, /Screens 3\/3/);
  assert.match(out, /No failures\./);
});

test('without slot tables on the masters the library file is the fallback; without both, content overrides drop to plain frames', () => {
  const withLib = run(ENRICHED, '--ds', '--no-slots', '--lib').ds;
  assert.equal(withLib.ovFail, 0);
  const without = run(ENRICHED, '--ds', '--no-slots');
  assert.ok(without.ds.plain > 0, 'plain fallbacks when text cannot be overridden: ' + JSON.stringify(without.ds));
  assert.match(without.out, /Screens 3\/3/);
});

test('token binding is optional', () => {
  const { ds } = run(ENRICHED, '--ds', '--no-tokens');
  assert.equal(ds.tokBound, 0);
  assert.ok(ds.inst >= 10);
});
