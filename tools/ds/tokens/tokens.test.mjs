// Tests for tools/ds/tokens/* (run with `npm test`). Fixture based tests reproduce fixtures/ds/tokens.json and the
// `tok` annotations of fixtures/ds/enriched-sample.figma.json from fixtures/ds/plain-sample.figma.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { harvest, annotate, tailwindFromConfig, loadTailwind, parseCssVariables, renderReport, harvestDetailed } from './index.mjs';
import { expandGlob } from './glob.mjs';
import { validate } from '../common/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FX = path.join(root, 'fixtures/ds');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-test-'));

// ---------------------------------------------------------------- small synthetic builders
const C = (r, g, b, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a });
const frame = (o = {}) => ({ t: 'frame', name: 'div', x: 0, y: 0, w: 100, h: 40, ls: { s: ['H', 'H'], k: 'V', g: 0, g2: 0, p: [0, 0, 0, 0], bw: [0, 0, 0, 0] }, ...o });
const file = (...frames) => ({ figmaLift: 1, frames });
const text = (color, font = {}) => ({ t: 'text', name: 'text', x: 0, y: 0, w: 10, h: 20, text: 'x', font: { family: 'F', size: 14, weight: 400, lh: 20, ls: 0, color, ...font }, ls: {} });
const lowThresh = { thresholds: { minUses: 1, minScreens: 1 }, generated: 'T' };

// ---------------------------------------------------------------- fixtures
test('harvest reproduces fixtures/ds/tokens.json from the plain sample', () => {
  const exp = rd('tokens.json');
  const cfg = rd('ds.config.json');
  const got = harvest([rd('plain-sample.figma.json')], { ...cfg, basedir: FX, inventory: rd('ds-inventory.json'), generated: exp.generated });
  const want = clone(exp); delete want.$schema;
  assert.deepEqual(got, want);
  assert.ok(validate('tokens', got).ok);
});

test('annotate reproduces the tok annotations of the enriched sample (from harvested and from fixture tokens)', () => {
  const enriched = rd('enriched-sample.figma.json');
  const cfg = rd('ds.config.json');
  const harvested = harvest([rd('plain-sample.figma.json')], { ...cfg, basedir: FX, inventory: rd('ds-inventory.json'), generated: 'x' });
  for (const tokens of [rd('tokens.json'), harvested]) {
    const plain = rd('plain-sample.figma.json');
    const before = clone(plain);
    const st = annotate(plain, tokens);
    assert.equal(st.nodes, 81);
    let checked = 0;
    const cmp = (a, b) => {
      assert.deepEqual(a.tok, b.tok);
      checked++;
      (a.children || []).forEach((c, i) => cmp(c, b.children[i]));
    };
    plain.frames.forEach((f, i) => cmp(f, enriched.frames[i]));
    assert.equal(checked, 81);
    // everything but `tok` is untouched
    const strip = (n) => { const o = { ...n }; delete o.tok; if (n.children) o.children = n.children.map(strip); return o; };
    assert.deepEqual(plain.frames.map(strip), before.frames);
  }
});

test('annotate is idempotent and removes stale tok', () => {
  const tokens = rd('tokens.json');
  const f = rd('plain-sample.figma.json');
  annotate(f, tokens);
  const once = clone(f);
  annotate(f, tokens);
  assert.deepEqual(f, once);
  f.frames[0].tok = { f: 'c:000000@100' };
  delete f.frames[0].fill; f.frames[0].ls = {}; delete f.frames[0].radius; delete f.frames[0].stroke;
  annotate(f, tokens);
  assert.equal(f.frames[0].tok, undefined);
});

// ---------------------------------------------------------------- harvest rules
test('colours: unique per (key, role), counted per node field, screens distinct', () => {
  const a = frame({ fill: C(255, 0, 0), children: [text(C(255, 0, 0))] });
  const b = frame({ fill: C(255, 0, 0) });
  const t = harvest([file(a, b)], lowThresh);
  const fill = t.colors.find((c) => c.key === 'c:ff0000@100' && c.role === 'fill');
  const txt = t.colors.find((c) => c.key === 'c:ff0000@100' && c.role === 'text');
  assert.equal(fill.count, 2); assert.equal(fill.screens, 2);
  assert.equal(txt.count, 1); assert.equal(txt.screens, 1);
  assert.deepEqual(t.source, { files: 1, screens: 2, nodes: 3 });
});

test('transparent fills and zero-width strokes are ignored', () => {
  const t = harvest([file(frame({ fill: C(1, 2, 3, 0), stroke: { c: C(9, 9, 9), w: [0, 0, 0, 0] } }))], lowThresh);
  assert.equal(t.colors.length, 0);
});

test('colour snapping merges noise into the more frequent value, never across different tailwind tokens', () => {
  const mk = (c, n) => Array.from({ length: n }, () => frame({ fill: c }));
  const t = harvest([file(...mk(C(25, 29, 36), 5), ...mk(C(25, 29, 37), 2))], lowThresh);
  assert.equal(t.colors.length, 1);
  assert.equal(t.colors[0].key, 'c:191d24@100');
  assert.equal(t.colors[0].count, 7);
  assert.deepEqual(t.colors[0].members.map((m) => m.key), ['c:191d25@100']);
  // two distinct tailwind colours stay apart even when dE is tiny
  const tw = tailwindFromConfig({ theme: { extend: { colors: { a: '#191d24', b: '#191d27' } } } }, { defaults: false });
  const t2 = harvest([file(...mk(C(25, 29, 36), 5), ...mk(C(25, 29, 39), 2))], { ...lowThresh, tailwind: tw });
  assert.equal(t2.colors.length, 2);
  // alpha beyond tolerance is not merged
  const t3 = harvest([file(frame({ fill: C(0, 0, 0, 0.4) }), frame({ fill: C(0, 0, 0, 0.5) }))], lowThresh);
  assert.equal(t3.colors.length, 2);
});

test('text styles: lh within 1px and ls within 0.02em merge; line height falls back to ls.tx.lh', () => {
  const t1 = text(C(0, 0, 0), { lh: 20 }), t2 = text(C(0, 0, 0), { lh: 19.5 }), t3 = text(C(0, 0, 0), { lh: 24 });
  const a = frame({ children: [t1, t1, t2, t3] });
  const t = harvest([file(a)], lowThresh);
  assert.equal(t.textStyles.length, 2);
  assert.equal(t.textStyles[0].count, 3);
  assert.equal(t.textStyles[0].members.length, 1);
  const n = text(C(0, 0, 0), { lh: null }); n.ls = { tx: { l: 1, lh: 22 } };
  assert.equal(harvest([file(frame({ children: [n] }))], lowThresh).textStyles[0].key, 't:F/14/400/22/0');
});

test('spacing ignores space-between gaps, huge gaps and subtracts the border from padding', () => {
  const fr = (ls) => frame({ ls: { s: ['H', 'H'], k: 'H', g: 0, g2: 0, p: [0, 0, 0, 0], bw: [0, 0, 0, 0], ...ls } });
  const t = harvest([file(
    fr({ g: 12, pa: 'SPACE_BETWEEN' }), fr({ g: 1.63 }), fr({ g: 687 }), fr({ g: 8, p: [17, 17, 17, 17], bw: [1, 1, 1, 1] }), fr({ p: [-1, 0, 0, 0] }),
  )], lowThresh);
  const keys = t.spacing.map((s) => s.key).sort();
  assert.deepEqual(keys, ['sp:1.63', 'sp:16', 'sp:8']);
});

test('statuses: bound, create, skip, off-scale and snap-candidate hint; no tailwind means every value is a token', () => {
  const tw = tailwindFromConfig({ theme: { extend: { borderRadius: { md: '8px' } } } }, { defaults: false });
  const rs = [8, 8, 8, 10, 10, 10, 8.3, 8.3, 8.3, 99].map((r) => frame({ radius: r }));
  const t = harvest([file(...rs.slice(0, 5)), file(...rs.slice(5))], { tailwind: tw, generated: 'T' });
  const by = (k) => t.radii.find((r) => r.key === k);
  assert.equal(by('r:8').status, 'create');
  assert.equal(by('r:8').target.name, 'radius/md');
  assert.equal(by('r:10').status, 'off-scale');
  assert.match(by('r:8.3').nearest, /snap candidate/);
  assert.equal(by('r:99').status, 'skip');
  assert.equal(by('r:99').target, undefined);
  const t2 = harvest([file(...rs.slice(0, 5)), file(...rs.slice(5))], { generated: 'T' });
  assert.equal(t2.radii.find((r) => r.key === 'r:10').status, 'create');
  assert.equal(t2.radii.find((r) => r.key === 'r:10').target.name, 'radius/10');
});

test('inventory: existing variables become bound with ids, by name and by value', () => {
  const inv = clone(rd('ds-inventory.json'));
  // a spacing value that has no tailwind name in the config but exists as a variable
  inv.variables.push({ id: 'V:77', key: 'k', name: 'gap/odd', collection: inv.collections[1].id, type: 'FLOAT', scopes: ['GAP'], valuesByMode: { [inv.collections[1].modes[0].id]: 17 } });
  const kids = Array.from({ length: 4 }, () => frame({ ls: { s: ['H', 'H'], k: 'H', g: 17, g2: 0, p: [0, 0, 0, 0], bw: [0, 0, 0, 0] } }));
  const t = harvest([file(...kids)], { ...rd('ds.config.json'), basedir: FX, inventory: inv, generated: 'T' });
  const e = t.spacing.find((s) => s.key === 'sp:17');
  assert.equal(e.status, 'bound');
  assert.deepEqual(e.existing, { id: 'V:77', name: 'Layout/gap/odd' });
});

test('gradients and effects are keyed and referenced', () => {
  const g = { type: 'linear', angle: 135, stops: [{ c: C(255, 0, 0), pos: 0 }, { c: C(0, 0, 255), pos: 1 }] };
  const sh = [{ c: C(0, 0, 0, 0.25), x: 0, y: 4, blur: 8, spread: 0 }];
  const n = frame({ grads: [g], shadow: sh });
  const f = file(n);
  const t = harvest([f], lowThresh);
  assert.equal(t.gradients[0].key, 'g:linear:135:ff0000@100~0,0000ff@100~100');
  assert.equal(t.effects[0].key, 'e:0,4,8,0,000000@25');
  assert.ok(validate('tokens', t).ok);
  annotate(f, t);
  assert.deepEqual(n.tok.gr, [{ i: 0, key: t.gradients[0].key }]);
  assert.equal(n.tok.e, 'e:0,4,8,0,000000@25');
});

test('snapped members are written with their leader key', () => {
  const mk = (c, n) => Array.from({ length: n }, () => frame({ fill: c }));
  const f = file(...mk(C(25, 29, 36), 5), ...mk(C(25, 29, 37), 2));
  const t = harvest([f], lowThresh);
  annotate(f, t);
  assert.ok(f.frames.every((x) => x.tok.f === 'c:191d24@100'));
});

test('skip and off-scale values are not referenced by tok', () => {
  const f = file(frame({ radius: 10, fill: C(1, 2, 3) }));
  const t = harvest([f], { thresholds: { minUses: 5, minScreens: 1 }, generated: 'T' });
  annotate(f, t);
  assert.equal(f.frames[0].tok, undefined);
});

test('report renders counts and does not throw on empty input', () => {
  const t = harvest([], { generated: 'T' });
  assert.match(renderReport(t), /Tokens report/);
  const { tokens, stats } = harvestDetailed([rd('plain-sample.figma.json')], { ...rd('ds.config.json'), basedir: FX, inventory: rd('ds-inventory.json') });
  const text2 = renderReport(tokens, stats);
  assert.match(text2, /Off-scale values \(2\)/);
  assert.match(text2, /Review items \(2\)/);
});

// ---------------------------------------------------------------- tailwind reader
test('tailwind: CommonJS fixture, flattening, DEFAULT keys and defaults merge/replace', () => {
  const m = loadTailwind(path.join(FX, 'tailwind.config.cjs'));
  assert.ok(m.colors.some((c) => c.name === 'accent'));
  assert.equal(m.radius.md, 8); assert.equal(m.radius.xl, 16);
  assert.equal(m.spacing['3'], 12);
  assert.ok(!('full' in m.radius));
  const r = tailwindFromConfig({ theme: { spacing: { a: '3px' }, extend: { colors: { x: { DEFAULT: '#fff', dk: '#000' } } } } });
  assert.deepEqual(r.spacing, { a: 3 });
  assert.deepEqual(r.colors.map((c) => c.name).slice(0, 2), ['x', 'x-dk']);
});

test('tailwind: ESM, TypeScript syntax, stubbed plugins, theme functions and relative requires', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'palette.js'), "module.exports = { brand: '#112233' };");
  fs.writeFileSync(path.join(d, 'a.mjs'), [
    "import plugin from 'tailwindcss/plugin';", "import colors from 'tailwindcss/colors';", "import defaultTheme from 'tailwindcss/defaultTheme';",
    "const palette = require('./palette.js');",
    'export default {', ' content: [], plugins: [plugin(() => {})],',
    ' theme: { extend: { colors: ({ theme }) => ({ ...palette, same: theme("colors.brand"), bad: colors.slate[500] }),',
    "   fontFamily: { sans: [...defaultTheme.fontFamily.sans] }, borderRadius: { pill: '99px', card: '1.25rem' } } },", '};',
  ].join('\n'));
  const m = loadTailwind(path.join(d, 'a.mjs'), { defaults: false });
  assert.deepEqual(m.colors.map((c) => [c.name, Math.round(c.rgba.r * 255)]), [['brand', 17], ['same', 17]]);
  assert.equal(m.radius.card, 20);
  assert.equal(m.radius.pill, 99);
  const ts = path.join(d, 'b.ts');
  fs.writeFileSync(ts, "import type { Config } from 'tailwindcss';\nconst config: Config = { content: [], theme: { extend: { colors: { z: '#010203' } } } } satisfies Config;\nexport default config;\n");
  assert.equal(loadTailwind(ts, { defaults: false }).colors[0].name, 'z');
  assert.throws(() => loadTailwind(path.join(d, 'missing.js')), /cannot evaluate/);
});

test('tailwind: css variable hook resolves hsl(var()) and reports unresolved ones', () => {
  const cfg = { theme: { extend: { colors: { primary: 'hsl(var(--primary))', ghost: 'rgb(var(--ghost) / <alpha-value>)' } } } };
  const css = parseCssVariables(':root { --primary: 0 100% 50%; /* red */ } .dark { --primary: 1 1 1; }');
  assert.equal(css['--primary'], '0 100% 50%');
  const m = tailwindFromConfig(cfg, { cssVars: css, defaults: false });
  assert.deepEqual(m.colors.map((c) => c.name), ['primary']);
  assert.equal(Math.round(m.colors[0].rgba.r * 255), 255);
  assert.deepEqual(m.unresolved.map((u) => u.name), ['ghost']);
});

// ---------------------------------------------------------------- glob + CLI
test('glob expands ** and {a,b}', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'x/y'), { recursive: true });
  for (const f of ['a.figma.json', 'x/b.figma.json', 'x/y/c.json']) fs.writeFileSync(path.join(d, f), '{}');
  const rel = (l) => l.map((f) => path.relative(d, f).replace(/\\/g, '/'));
  assert.deepEqual(rel(expandGlob('**/*.figma.json', d)), ['a.figma.json', 'x/b.figma.json']);
  assert.deepEqual(rel(expandGlob('x/**/*.{json}', d)), ['x/b.figma.json', 'x/y/c.json']);
});

test('CLI: writes tokens.json and enriched copies, never overwrites inputs, exit codes', () => {
  const d = tmp();
  fs.copyFileSync(path.join(FX, 'plain-sample.figma.json'), path.join(d, 'plain.figma.json'));
  const before = fs.readFileSync(path.join(d, 'plain.figma.json'), 'utf8');
  const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tokens.mjs'), ...a], { encoding: 'utf8', cwd: root });
  const out = path.join(d, 'out');
  const r = run('--in', path.join(d, '*.figma.json'), '--config', path.join(FX, 'ds.config.json'), '--inventory', path.join(FX, 'ds-inventory.json'), '--out', out, '--report');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Tokens report/);
  assert.ok(validate('tokens', JSON.parse(fs.readFileSync(path.join(out, 'tokens.json'), 'utf8'))).ok);
  const enriched = JSON.parse(fs.readFileSync(path.join(out, 'plain.figma.json'), 'utf8'));
  assert.deepEqual(enriched.frames[0].tok && Object.keys(enriched.frames[0].tok).sort(), Object.keys(rd('enriched-sample.figma.json').frames[0].tok).sort());
  assert.equal(fs.readFileSync(path.join(d, 'plain.figma.json'), 'utf8'), before);
  // out dir == input dir: refuses to overwrite
  const same = run('--in', path.join(d, '*.figma.json'), '--out', d);
  assert.equal(same.status, 1);
  assert.equal(fs.readFileSync(path.join(d, 'plain.figma.json'), 'utf8'), before);
  assert.equal(run().status, 2);
  assert.equal(run('--in', path.join(d, 'nothing*.json')).status, 1);
  assert.equal(run('--bogus').status, 2);
});
