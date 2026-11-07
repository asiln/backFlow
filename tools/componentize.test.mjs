// End-to-end test of componentize.mjs on the generic fixture (fixtures/ds/plain-sample.figma.json): detection, variants, schema validity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { componentize } from '../componentize.mjs';
import { validate, formatErrors } from './ds/common/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/ds/ds.config.json'), 'utf8'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-cz-'));
const r = await componentize({ in: [path.join(root, 'fixtures/ds/plain-sample.figma.json')], exclude: [], out, report: false, hooks: true, pretty: false, dry: false, config: cfg, configDir: path.join(root, 'fixtures/ds'), skip: '^$' });
const lib = r.library;
const enriched = JSON.parse(fs.readFileSync(path.join(out, 'plain-sample.figma.json'), 'utf8'));
const cmps = [];
(function walk(n) { if (n.cmp) cmps.push(n); (n.children || []).forEach(walk); })({ children: enriched.frames });

test('library validates against the schema', () => {
  const v = validate('library', lib);
  assert.ok(v.ok, formatErrors(v));
});
test('buttons, list items and the card are detected', () => {
  const names = lib.components.map((c) => c.name);
  for (const n of ['Button', 'List Item', 'Card']) assert.ok(names.includes(n), n + ' in ' + names);
});
test('paint differences become variants, not overrides', () => {
  const b = lib.components.find((c) => c.name === 'Button');
  assert.ok(b.variants && b.variants.members.length >= 2);
  const btn = cmps.filter((n) => n.cmp.id === b.id);
  assert.ok(btn.every((n) => n.cmp.v), 'every button instance names its variant');
  assert.ok(btn.every((n) => !(n.cmp.ov || []).some((o) => 'fill' in o)), 'no redundant fill overrides');
  const names = new Set(b.variants.members.map((m) => JSON.stringify(m.v)));
  assert.equal(names.size, b.variants.members.length, 'variant maps are distinct');
});
test('every cmp points at a library component or icon', () => {
  const ids = new Set([...lib.components.map((c) => c.id), ...lib.icons.map((i) => i.id)]);
  for (const n of cmps) assert.ok(ids.has(n.cmp.id), n.cmp.id);
});
test('originals are not modified in place on disk', () => {
  const plain = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/ds/plain-sample.figma.json'), 'utf8'));
  let any = false; (function walk(n) { if (n.cmp) any = true; (n.children || []).forEach(walk); })({ children: plain.frames });
  assert.equal(any, false);
});
